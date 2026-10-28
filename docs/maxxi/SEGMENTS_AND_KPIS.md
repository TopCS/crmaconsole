# Segmenti e KPI

Vista: `/maxxi/segments` · API: `GET /api/maxxi/segment` · KPI: `GET /api/maxxi/overview`

## Orologio

Tutti i calcoli usano il clock fisso `2026-10-28T12:00:00+01:00`. Nessun numero è
hardcoded: ogni valore viene da una query sul dataset demo.

## KPI (`getDashboardKpis`)

| KPI | Definizione |
|---|---|
| `identifiedPeople` | persone univoche nel dataset (non accessi, non biglietti anonimi) |
| `linkedPeople` | persone con almeno un identity link `status='linked'` |
| `anonymousSubjects` | eventi con `person_id IS NULL` |
| `totalEvents` | eventi normalizzati |
| `attendedVisits` | `museum_visit_attended` attribuiti a una persona |
| `purchases` | `exhibition_ticket_purchased` (un acquisto **non** è una visita) |
| `membershipsExpiring45d` | myMAXXI con `valid_to` in `[2026-10-28, 2026-12-12]` |
| `membershipsExpired` | myMAXXI con `valid_to` < clock |
| `openFeedback` | casi infopoint `open` |
| `pendingReviews` | candidati identità `pending` |
| `sources` | fonti registrate |

Valori con il fixture di riferimento: 8 / 6 / 1 / 11 / 6 / 2 / 5 / 0 / 1 / 1 / 2.

## Segmento `S_ARCH_RENEWAL_45D`

Condizioni (tutte obbligatorie):

1. interesse **esplicito** per `architecture` (oppure evento con `topic=architecture`);
2. membership myMAXXI con `valid_to ∈ [2026-10-28, 2026-12-12]`
   (finestra di 45 giorni dal clock);
3. almeno 1 evento attribuito negli ultimi **365 giorni**;
4. consenso `event_marketing` / `email` = `granted`;
5. identità con confidenza ≥ 0.95.

### Classificazione delle esclusioni

Un contatto è classificato con **una sola** ragione, in ordine di precedenza:

| Ordine | Ragione | Significato |
|---|---|---|
| 1 | `excluded_identity_uncertain` | nessun link o confidenza < 0.95 |
| 2 | `excluded_no_interest` | nessun interesse esplicito in architettura |
| 3 | `excluded_membership_window` | card fuori dalla finestra di 45 giorni |
| 4 | `excluded_no_interaction` | nessun evento negli ultimi 365 giorni |
| 5 | `excluded_consent` | sarebbe eleggibile, ma il consenso non è valido |

La precedenza evita il doppio conteggio: "esclusi per consenso" significa
*"esclusi **a causa del** consenso"*, non "persone che hanno anche il consenso
mancante".

### Risultato atteso sul fixture

| Persona | Esito | Motivo |
|---|---|---|
| P-MARIA | **inclusa** | architettura, card 2026-11-20, consenso `granted` |
| P-ELENA | **inclusa** | architettura, card 2026-12-05, consenso `granted` |
| P-GIULIA | esclusa | consenso `unknown` |
| P-PAOLO | esclusa | consenso `withdrawn` (2026-10-01) |
| P-LUCA | esclusa | card 2026-12-20 fuori finestra |
| P-SARA | esclusa | interesse `photography`, non architettura |
| P-MARIA-AMBIG | esclusa | identità incerta (nessun link) |
| P-GIOVANNI | esclusa | identità incerta (nessun link) |

Contatori: `eligible=2`, `excludedConsent=2`, `excludedIdentity=2`,
`excludedMissingData=2`.

## Perché non ci sono altri segmenti in UI

`S_RETURNING_VISITORS` e `S_MEMBERSHIP_AT_RISK` sono definiti nel fixture come
contratto, ma la UI espone solo il segmento usato nel percorso demo. Aggregare
"visitatori ricorrenti" richiede ≥2 visite attribuite: nel fixture nessuno le ha,
quindi il segmento sarebbe vuoto — meglio non mostrarlo che mostrarlo vuoto.

## Test

`apps/web/lib/maxxi/seed.test.ts`:

- eleggibili identici alla lista di riferimento del fixture;
- esclusi per consenso = `[P-GIULIA, P-PAOLO]`;
- stabilità tra due valutazioni consecutive;
- ogni esclusione ha almeno una motivazione testuale.

## Trasparenza

La UI mostra `Dati dimostrativi generati, non statistiche del MAXXI` e il banner
`DEMO - DATI SINTETICI - NESSUN INVIO ESTERNO`.
