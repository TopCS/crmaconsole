# Mappatura fonti → dati normalizzati

Tutte le fonti sono **connettori demo simulati**. I tracciati (XLS/CSV) sono
inventati e non riproducono il formato dei fornitori reali: la struttura va
confermata in fase di integrazione.

## Registro fonti (`maxxi_source_registry`)

| `source_system` | Origine dichiarata | Cosa identifica nel fixture | Stato |
|---|---|---|---|
| `site_form` | Form sito / newsletter | email verificata | mock |
| `archeoares_xls` | Report biglietteria | solo con card/email collegabile | mock |
| `mymaxxi_manual` | Anagrafiche membership | card + email | mock |
| `biblioteca_manual` | Iscrizioni/accessi biblioteca | card biblioteca (namespace distinto) | mock |
| `infopoint_xls` | Report richieste infopoint | contatto se presente | mock |
| `operator_relation` | Note manuali operatore | persona/organizzazione | mock |
| `matomo_aggregate` | Analytics web | nessuno (aggregati) | mock |
| `sproutsocial_aggregate` | Social | nessuno (aggregati) | mock |
| `capacity_aggregate` | Sensori capienza | nessuno (aggregati) | mock |
| `wifi_none` | Wi-Fi | nessuno | mock |

Nel fixture di riferimento sono popolate 2 fonti con record individuali
(`site_form`, `mymaxxi_manual`) e le altre restano descritte ma senza righe: la
UI le mostra comunque, dichiarando lo stato.

## Campi di provenienza

Ogni riga importata porta:

```
source_system      sistema di origine
source_record_id   id stabile nel sistema di origine
observed_at        quando è stata importata (clock demo)
occurred_at        quando è avvenuto il fenomeno (eventi)
```

La coppia `(source_system, source_record_id, type)` è **unique** su
`maxxi_event`: una reimportazione non crea eventi duplicati.

## Regole di identity resolution

Implementate in `resolveIdentity()` (`apps/web/lib/maxxi/seed.ts`):

| Ordine | Condizione | Esito |
|---|---|---|
| 1 | email **verificata** identica a una persona canonica | auto-link, `match_method=verified_email`, `confidence=1.0` |
| 2 | `card_code` nel namespace myMAXXI con owner noto | auto-link, `card_code_namespace`, `0.95` |
| 3 | email non verificata ma identica | link, `email_unverified`, `0.6` |
| 4 | nome uguale a un contatto **diverso** | **review candidate**, nessun merge |
| 5 | nessun identificativo | unmatched (conteggiato) |

Con il fixture: 7 link, 1 candidato (`P-MARIA-AMBIG`), 0 unmatched.

## Numeri di qualità mostrati in UI

- righe importate per fonte;
- non attribuite (`unmatched_count`);
- da revisionare (`quarantined_count`);
- ultimo import e stato.

## Cosa NON viene fatto

- Nessuna deduplica su nome/età/interessi.
- Nessuna attribuzione di un biglietto anonimo (`T-ANON-001` resta
  `person_id = NULL`).
- Nessuna inferenza di identità da Wi-Fi, sensori di capienza o analytics
  aggregati.
- Nessuna scrittura sui sistemi di origine.
