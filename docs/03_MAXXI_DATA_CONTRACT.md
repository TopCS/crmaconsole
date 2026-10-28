# MAXXI CDP - data model, mapping, provenance, identity e consenso

Questo documento e' il **contratto semantico** del vertical. Il modello fisico definitivo va adattato a `workspace-schema-migrations.ts`, all'EAV DuckDB esistente e alle API implementabili. Non creare tabelle duplicate per dati che hanno gia' un oggetto equivalente. Le definizioni qui sotto sono agnostiche rispetto allo storage.

## 1. Fonti dati e aspettative realistiche

| ID fonte demo | Origine dichiarata | Tipo dati / granularita' | Cosa puo' identificare | Verifica necessaria per la produzione |
|---|---|---|---|---|
| `site_form` | Form sito/newsletter/eventi | Persona, opt-in, evento form | Email inserita dall'utente | Form attuali, campi consenso, API Wordpress/plugin |
| `archeoares_xls` | Biglietteria Archeoares | Report giornaliero xls; categorie ticket e membership | Solo se in fixture esiste codice card/email collegabile | Tracciato reale e livello dati individuali |
| `mymaxxi_manual` | Membership myMAXXI | Anagrafiche e card, storicamente form cartacei | Codice card + dati contatto verificabili | Procedure attuali e record di consenso |
| `biblioteca_manual` | Biblioteca | Iscrizione + card, accessi da tornelli | Card biblioteca, NON automaticamente card myMAXXI | Sistemi, ID comuni, diritti d'uso dei dati |
| `infopoint_xls` | Centralino / infopoint | Report quotidiano, richieste | Contatto solo se presente | Se report nominativo o solo aggregato |
| `education_manual` | Ufficio Educazione | Iscrizioni ad attivita' | Persona registrata (se presente) | Tracciati e autorizzazioni |
| `matomo_aggregate` | Matomo web analytics | Eventi web di norma anonimi | Nessuno nel fixture senza identificazione esplicita | Consent mode / scope tracking |
| `sproutsocial_aggregate` | SproutSocial | Metriche social aggregate | Nessuno per default | Feed autorizzato e termini piattaforma |
| `capacity_aggregate` | Sensori capienza sale | Conteggi aggregati | Nessuno | KPI ambientali, no collegamento individuale |
| `wifi_none` | Wi-Fi free | Nessuna registrazione descritta | Nessuno | Non simularne il riconoscimento personale |
| `operator_relation` | Note manuali personale | Persona/organizzazione e appunti | Solo con identificazione esplicita | Governance e access control per note riservate |

**Regola cardine:** un biglietto non nominativo e' un evento aggregato o non attribuibile. Non dedurre la visita di Maria solo perche' e' nello stesso giorno di una mostra. Non inferire identita' da Wi-Fi, sensori di capienza o semplici analytics.

## 2. Oggetti concettuali obbligatori

- `person`: `person_id`, nome, email normalizzata (eventuale), telefono normalizzato (eventuale), profilo/lingua, `created_at`, `updated_at`. Non memorizzare attributi sensibili in demo.
- `organization`: `organization_id`, nome, tipo relazionale (`sponsor`, `partner`, `donor_company`, ecc.), contatti.
- `identity_link`: `person_id`, `source_system`, `source_record_id`, `match_method`, `confidence`, `status`, `matched_at`, `reviewed_by`, `reviewed_at`. Uno stesso source record non va assegnato a due persone canoniche attive.
- `consent`: `person_id`, `purpose` (`newsletter`, `event_marketing`, ecc.), `channel` (`email`, `phone`, ecc.), `status` (`granted`,`denied`,`withdrawn`,`unknown`), `captured_at`, `withdrawn_at`, `source_system`, `source_record_id`, `evidence_id`. Nessun flag unico `marketingOptIn` in grado di sovrascrivere il dettaglio per scopo/fonte.
- `event_catalog`: `event_id`, nome, tipo, `start_at`, `end_at`, fonte pubblica. `event` e `exhibition` distinti solo se serve; le mostre reali sono catalogo pubblico, non sono prova di partecipazione.
- `interaction_event`: `event_id`, `person_id|null`, `anonymous_subject_id|null`, `type`, `occurred_at`, `observed_at`, `source_system`, `source_record_id`, `properties`, `event_catalog_id|null`, `evidence_id`. Distinguere sempre visita effettiva, acquisto, registrazione, email, feedback.
- `membership`: `membership_id`, `person_id|null`, `card_code`, `product` (`myMAXXI` / library), `valid_from`, `valid_to`, `status`, `source_system`, `source_record_id`, `recorded_at`.
- `ticket_purchase`: `ticket_id`, `person_id|null`, `membership_id|null`, `type`, `occurred_at`, `amount|null`, `currency|null`, `catalog_item_id|null`, `source_record_id`. Se non identificabile, `person_id=null`.
- `event_registration`: `registration_id`, `person_id`, `catalog_item_id`, `registered_at`, `attendance_status` (`registered`,`attended`,`no_show`,`unknown`). `registered != attended`.
- `feedback_case`: `case_id`, `person_id|null`, `channel`, `category`, `opened_at`, `closed_at|null`, `status`, `summary`, `source_record_id`, `evidence_id`.
- `relationship`: persona-organizzazione, azienda-sponsorizzazione, persona-collega; con tipo, fonte, `valid_from` / `valid_to` quando noti.
- `campaign`: `campaign_id`, `segment_id`, `subject`, `body`, `created_by`, `status` (`draft`,`approved_simulated`,`simulated`), `delivery_mode='dry_run'` per tutto il workspace.
- `action_audit`: `id`, `workspace_id`, `principal_id`, `action`, `target_id`, `requested_at`, `approved_at`, `status`, `details_sanitized`.
- `source_registry`: `source_system`, descrizione, `mock_or_live`, `last_imported_at`, `last_import_status`, `row_count`, `unmatched_count`, `quarantined_count`.

## 3. Event taxonomy e sequenza

Eventi normalizzati consigliati:

```
form_submitted
newsletter_consent_granted
newsletter_consent_withdrawn
membership_activated
membership_renewed
membership_expired
exhibition_ticket_purchased
museum_visit_attended
library_checkin
exhibition_interest_declared
event_registered
event_attended
infopoint_request_created
feedback_submitted
feedback_resolved
campaign_draft_created
campaign_previewed
campaign_approval_simulated
```

Nota: `museum_visit_attended` richiede evidenza verificabile. Non derivarlo da un'acquisizione di biglietto; un acquisto puo' non tradursi in ingresso.

`occurred_at`: data del fenomeno; `observed_at`: data di importazione. `source_record_id`: stabile. Una coppia `(source_system, source_record_id, normalized_type)` deve essere idempotente. Duplicati importativi non diventano eventi nuovi.

## 4. Identity resolution conservativa

Ordine delle regole:

1. `verified_identity_id` proveniente da una fonte attendibile e compatibile con un mapping gia' validato: merge automatico.
2. Email verificata esattamente uguale (normalizzazione prudente: trim + lowercase del dominio/casella solo dove consentito) e nessun conflitto: auto-link; annotare la regola e la fonte.
3. Card code esatto **entro lo stesso namespace** (biblioteca e myMAXXI non sono lo stesso namespace se non certificato): link solo se mapping ufficiale.
4. Numero E.164 da fonte verificata e senza collisioni: candidato da revisionare, non auto merge indiscriminato.
5. Solo nome, eta' e interessi, indirizzo o somiglianza fuzzy: **mai fusione automatica**; creare candidate review.

Un evento anonimo resta anonimo fino a identificazione esplicita/consentita. Tracciare `match_method`, `confidence`, `source`, `review_status`; conservare source IDs pre-merge.

Conflict handling: scegliere valore osservato piu' recente **solo** quando regola deterministica e semantica lo consentono. Per nome/cognome/telefono, record in conflitto => review; non sovrascrivere silenciosamente dati curati da operatore.

## 5. Scopi, consenso e minimizzazione

- Un'importazione legittima per erogazione del servizio non implica consenso a email promozionali.
- Le campagne marketing filtrano per `consent.status='granted'` e purpose/channel specifici; `withdrawn`, `denied`, `unknown` e data assente sono esclusi (fail-closed).
- Aggiungere filtri di suppression per bounced, complained e unsubscribed; riutilizzare quanto presente in `campaigns.ts`.
- In demo consentimento fittizio per ogni persona, con `source_record_id` e timestamp; la demo non attesta la conformita' reale del MAXXI.
- I dati per finalita' biblioteca, educazione e membership non sono automaticamente riutilizzabili per marketing; il prodotto deve poter distinguere fonte, scopo e conservazione.
- Non introdurre dati relativi a salute, disabilita', religione, opinioni politiche, categorie vulnerabili o deduzioni psicografiche.

## 6. Segment definitions e risultati deterministici

Segmento `S_ARCH_RENEWAL_45D`:

- `myMAXXI` con `valid_to` tra 2026-10-28 e 2026-12-12 inclusi;
- interesse **esplicito** in `architecture`, oppure evento esplicitamente qualificato di architettura, indicandone il motivo;
- almeno 1 interazione qualificata nei precedenti 365 giorni;
- consenso attivo per `event_marketing` / `email` e nessuna suppression;
- persona identificata in maniera valida.

Segmento `S_RETURNING_VISITORS`:
- almeno 2 `museum_visit_attended` attribuibili negli ultimi 365 giorni;
- non contare purchase-only; consenso necessario solo se usato in una campagna, non per analisi aggregata dove la base giuridica lo consenta.

Segmento `S_MEMBERSHIP_AT_RISK`:
- `myMAXXI` scaduta nei 60 giorni precedenti senza rinnovo registrato; NON inventare predizione churn.

Il calcolo deve usare `now` iniettato (clock fisso 2026-10-28T12:00:00+01:00 nelle fixture) affinche' test e demo siano riproducibili. Valorizzazioni e risultati vanno ricalcolati dal seed, non hardcoded nella UI.

## 7. KPI, lineage e audit

- Ogni riga UI dovrebbe poter risalire a `source_system:source_record_id`.
- `confidence` non e' verita' statistica: distinguerlo da regole hard e dal punteggio euristico di match.
- `RFM`: Recency/Frequency dalle visite attribuite e Monetary solo se esiste spesa attribuita. Nelle dashboard non chiamare vendite anonime 'spesa del visitatore'.
- Visualizzare `data_quality`: source, last imported, record unmapped, unresolved identity candidates, fonte non collegata, membership scaduta, contatto non autorizzato al marketing.
- Mostra audit per azioni AI e azioni umane, inclusi gli step di approvazione simulata.

## 8. Seed, contratti di importazione e idempotenza

Il file `fixtures/maxxi_demo_seed.json` e' **seed minimo illustrativo**; l'harness deve farne un loader che genera le viste e faccia emergere il comportamento dei casi ambigui. Poi puo' espandere a 250-500 persone sintetiche deterministiche con `seed=20261028`, garantendo almeno:
- un visitatore rappresentato da 3 fonti con link certo;
- un omonimo che NON viene fuso;
- un ticket anonimo che NON viene attribuito;
- persona con consenso ritirato esclusa da una campagna;
- membership attiva, in scadenza e scaduta;
- feedback aperto con follow-up;
- sostenitore fittizio e organizzazione;
- eventi con data e provenance.

Reimportando due volte, conteggio persone, eventi e card uguale; niente eventi duplicate. Reset demo senza intaccare altri workspace.

## 9. Adapter di import demo (contratto)

Preferire parser offline che leggono fixture e creano normalized records; esempi di file opzionali:

```
fixtures/sources/site_forms.csv
fixtures/sources/archeoares_report.csv
fixtures/sources/mymaxxi_membership.csv
fixtures/sources/library_checkins.csv
fixtures/sources/infopoint_requests.csv
```

I tracciati CSV di demo devono essere dichiarati **inventati**, non spacciati per layout dei file dei fornitori. La struttura reale deve essere confermata in fase di integrazione.
