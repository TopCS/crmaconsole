# Acceptance test plan + copione presentazione MAXXI

## 1. Gate di consegna

- `G0 baseline`: commit revision registrata, branch non distruttivo, `pnpm check`, `pnpm test`, build provati e risultati descritti (distinguere problemi preesistenti).
- `G1 security`: endpoint CRM/graph/memory/workspace/SQL non leggibili da anonimo; webhook/trackers come eccezioni esplicite; injection test su DB test; shipping bloccato se endpoint aperti.
- `G2 seed`: import idempotente, nessun dato reale, nessun merge su nome soltanto, nessuna attribuzione di ticket anonimo.
- `G3 demo UI`: 9 viste se praticabili, minimo 5 complete (dashboard, profilo 360, fonti, segmenti, campagne); le altre possono essere tab collegate ma devono mostrare dati coerenti.
- `G4 Agent`: risposte basate su tool/query, fonte/campo/id; niente metriche inventate; fallback senza provider cloud.
- `G5 Actions`: **zero outbound reale** (bloccare API, worker, cron, tool e provider); audit dell'approvazione simulata.
- `G6 regression`: workspace non MAXXI invariato; test e build eseguiti; istruzioni avvio e reset.

## 2. Matrice test minimi (id -> procedura -> esito atteso)

| ID | Procedura | Esito obbligatorio |
|---|---|---|
| SEC-001 | GET non autenticata su `/api/crm/people` | 401/403 |
| SEC-002 | GET non autenticata su `/api/crm/graph` e `/api/memories` | 401/403, nessun contenuto |
| SEC-003 | POST non autenticata su `/api/workspace/query` e `/api/workspace/execute` | 401/403, DB invariato |
| SEC-004 | Utente/servizio workspace A prova leggere workspace MAXXI | 403, zero record cross-workspace |
| SEC-005 | Input SQL multi-statement e comandi distruttivi nel DB test | Sempre respinti, nessun side effect |
| SEC-006 | Invio campagna da UI + API + tool + worker in modalita' demo | Nessuna chiamata a provider esterni, solo audit dry run |
| SEC-007 | Accesso Funnel/porta pubblica senza sessione | Impossibile o richieste negate |
| ID-001 | Import `P-MARIA-WEB`, `P-MARIA-MEMBER` (link certo) | Un profilo canonico, due identificativi origine |
| ID-002 | Import omonima `P-MARIA-AMBIG` | Candidate review, nessun merge |
| ID-003 | Import ticket `T-ANON-001` | Nessun `person_id`; KPI visite identificate invariato |
| ID-004 | Doppia esecuzione seed | Conteggi stabili, no duplicati |
| DATA-001 | Profilo Maria | Fonti, eventi, membership, interessi visibili con riferimenti |
| DATA-002 | Evento `ticket_purchased` senza ingresso | NON segnato come `museum_visit_attended` |
| CON-001 | Ritiro consenso da persona seed | Esclusa dal segmento campagne immediatamente |
| CON-002 | Consenso `unknown` | Nessuna audience email |
| SEG-001 | Calcolo segmento `S_ARCH_RENEWAL_45D` al clock fixture | Identico dopo reload, ragioni di inclusione/esclusione corrette |
| KPI-001 | Dashboard numeri | Coerenti con conteggi query sui fixture |
| AGT-001 | Prompt su rinnovi e architettura | Conteggio esatto + fonti + finestra 45 giorni |
| AGT-002 | Prompt senza evidenza su donazione | Risposta non disponibile; non inventa valore |
| UI-001 | Header e report | Banner demo e note dati sintetici visibili |
| UI-002 | Campagna anteprima | Template bozza e approvazione simulata con audit |
| REG-001 | Apri workspace non MAXXI | Nessuna modifica schema/UX obbligatoria |

Test di sicurezza da eseguire solo su istanza/container e database di test isolati. Non lanciare probe su infrastruttura del museo.

## 3. Copione dal vivo (circa 12 minuti)

### Apertura (1')

"Abbiamo trasformato la logica del CRM in una Customer Data Platform: una rappresentazione unica del pubblico, ricostruita da fonti diverse e utilizzabile da operatori e agenti AI. Questa e' una demo locale su dati sintetici: non stiamo leggendo gli archivi del museo."

Mostra la dashboard: categorie `persone identificate`, `fonti ingest`, `eventi`, `membership in scadenza`, `casi infopoint`. Evidenzia che non vengono confusi biglietti totali e visitatori riconosciuti.

### Atto 1 - Profilo 360 (3')

- Apri pannello Fonti, scegli due eventi riconducibili a Maria.
- Cerca `Maria Rossi`, evidenzia identity links (form e membership), origine di ciascun campo, timeline e ticket legato alla card.
- Cerca `Maria Rossi omonima` e mostra il candidato da revisionare; mostra un ticket anonimo non attribuito.
- Narrazione: "I dati non sono soltanto accumulati: sappiamo perche' un'informazione e' collegata a questa persona e quando non e' sicuro farlo".

### Atto 2 - Segmentazione e agente (4')

Prompt 1:
```
Individua i titolari myMAXXI interessati all'architettura con card in scadenza entro 45 giorni, che hanno avuto almeno un'interazione nell'ultimo anno. Mostra quali sono contattabili via email marketing e perche'.
```

- Mostra query/segmento utilizzato e risultati riproducibili.
- Mostra esclusi per consenso sconosciuto/ritirato, anche se simili al target.
- Prompt 2:
```
Prepara una bozza email dedicata alla mostra Vitalita' dell'architettura italiana 1946-2026 e al rinnovo myMAXXI. Cita solo i dati del catalogo verificati. Non inviare nulla.
```

- Visualizza bozza e selezione pubblico; `Simula approvazione` e log.
- Narrazione: "La macchina propone e prepara. La governance decide; in demo non parte alcun messaggio".

### Atto 3 - Infopoint e membership (3')

- Apri Giulia Bianchi e suo feedback.
- Chiedi: `Riepiloga le sue interazioni e suggerisci un follow-up senza inviare messaggi.`
- Apri la relazione azienda-sostenitore nel modulo sostenitori.
- Narrazione: "La stessa memoria serve marketing, infopoint e relazioni istituzionali; cambiano i permessi, gli scopi e le azioni consentite".

### Chiusura (1')

- Distingui cio' che e' **implementato** dalla roadmap: real integration, migration, API, governance enterprise, analytics avanzate.
- Domanda di validazione al cliente: "Quale fonte e' piu' importante collegare per prima: biglietteria, myMAXXI o form online?".

## 4. Cosa deve esserci in DELIVERY_REPORT.md

```md
# Delivery Report - MAXXI CDP demo
- Branch / base SHA / final SHA:
- Esito G0 / G1 / G2 / G3 / G4 / G5 / G6:
- Comandi test eseguiti, output sommario e test NON eseguiti:
- Files modificati e migrazioni:
- Endpoint nuovi/modificati:
- Dati demo, fixture e reset:
- Runbook start/stop:
- Percorsi UI:
- Come riprodurre 3 scenari:
- Dove vengono simulati i connettori:
- Prove assenza invii:
- Gap e rischi residui:
- Task sprint successivo:
```

## 5. Decisione go/no-go

**GO locale:** tutti SEC-001..007 e G2..G6 verdi, niente dati reali, runbook verificato.

**NO-GO pubblicazione:** un solo endpoint dati non autenticato, emissione email/telefono, impossibilita' di dimostrare provenienza, merge non sicuro, segreti esposti, regressione distruttiva su workspace esistenti.
