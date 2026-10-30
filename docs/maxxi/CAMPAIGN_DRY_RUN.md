# Campagne: bozza, anteprima, approvazione simulata

Viste: `/maxxi/segments` (crea bozza) → `/maxxi/campaigns` (elenco, approvazione, audit).
API: `GET|POST /api/maxxi/campaigns`.

## Flusso

1. **Destinatari** — sempre l'audience eleggibile di `S_ARCH_RENEWAL_45D`
   (consenso `event_marketing/email = granted`, identità ≥ 0.95, finestra 45g).
   Chi non ha consenso valido non entra, nemmeno in simulazione.
2. **Bozza** — `createCampaignDraft()` scrive una riga in `maxxi_campaign` con
   `status='draft'` e `delivery_mode='dry_run'`, più una riga di audit
   `campaign_draft_created`.
3. **Approvazione simulata** — `approveCampaignSimulated()` porta lo stato a
   `approved_simulated` e scrive `campaign_approval_simulated` con timestamp.
   Non esiste alcuna chiamata di rete in nessuno dei due passi.
4. **Audit** — visibile in fondo alla vista Campagne: azione, target, principal,
   timestamp, stato.

## Contratto della risposta di bozza

```jsonc
{
  "campaignId": "CAMP-...",
  "segmentId": "S_ARCH_RENEWAL_45D",
  "status": "draft",
  "deliveryMode": "dry_run",
  "recipients": [{ "personId": "P-MARIA", "name": "Maria Rossi", "email": "maria.rossi@example.invalid" }],
  "counts": { "eligible": 2, "excludedConsent": 2, "excludedIdentity": 2, "excludedMissingData": 2 },
  "simulated": true,
  "externalCalls": 0
}
```

## Contenuto della comunicazione

La bozza cita esclusivamente il catalogo pubblico reale presente nel fixture
(`Vitalità dell'architettura italiana 1946-2026`, `2026-05-29 → 2026-11-15`).
Nessun orario, opening o prezzo viene inventato.

## Versioni e snapshot

- Ogni creazione genera la versione 1; ogni modifica di oggetto/testo crea una
  nuova versione (`maxxi_campaign_version`).
- Il pannello dettaglio mostra versione corrente, autore/data e confronto
  affiancato con le versioni precedenti.
- Una bozza approvata non è più modificabile.
- Alla **simulazione di approvazione** viene salvata una snapshot immutabile
  con destinatari, esclusioni e conteggi (`maxxi_campaign_snapshot`).
- Le modifiche successive al segmento non alterano la snapshot approvata.
- I contatti nella snapshot sono mascherati lato server per i ruoli senza
  `maxxi.people.read`.

## Dettaglio e anteprima della bozza

`GET /api/maxxi/campaigns?id=<campaignId>` restituisce la bozza completa:

- oggetto e testo integrale (`body`), stato e `deliveryMode`;
- segmento e finestra temporale, conteggi eleggibili/esclusi;
- destinatari eleggibili (nome, email) **solo** per ruoli con `maxxi.people.read`;
- esclusioni raggruppate per motivo;
- audit filtrato sulla singola bozza.

Nella UI `/maxxi/campaigns` il pulsante **Dettaglio** apre un pannello con
anteprima del testo, destinatari, esclusioni, audit e “Simula approvazione”.
Dopo la creazione dal segmento compare **Apri bozza**, che apre direttamente lo
stesso pannello via `?id=`. Per i ruoli senza `people.read` i conteggi restano
visibili ma nomi ed email sono omessi lato server.

## Prove di "zero invii"

Il blocco non è nella UI, è negli adapter (SEC-07). Con `CRM_A_DEMO_MODE=1`:

| Adapter | Effetto |
|---|---|
| `sendSesEmail` | lancia `Outbound disabled in demo mode (ses-email)` prima di leggere la config |
| `deliverToSession` | ritorna `{ ok: false, simulated: true }` |
| `postOutbound` (provider telefonico) | lancia prima della `fetch` |
| `nlpearlRequest` (metodi ≠ GET), `createVoicePearl` | lanciano prima della `fetch` |

Test: `apps/web/lib/security/demo-mode.test.ts` + verifica live che
`POST /api/maxxi/campaigns` risponda con `externalCalls: 0`.

## Cosa manca (dichiarato)

- Nessun template HTML/email: la bozza è testo semplice, mostrata in anteprima editoriale.
- Nessun versioning visuale con diff semantico: il confronto è affiancato.
- La snapshot è dimostrativa e non viene usata per invii reali.
- Nessuna programmazione temporale o invio differito.
- Nessun A/B test o misurazione di conversione (i numeri sarebbero inventati).
