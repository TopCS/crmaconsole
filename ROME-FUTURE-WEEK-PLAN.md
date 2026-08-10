# Piano — CRM Harness per "Demo per Rome Future Week"

Stato: bozza di pianificazione (analisi + piano, non codice).
Demo di riferimento: `~/Downloads/Demo per Rome Future Week.pdf` (5 atti).
Canale messaggistica: **Telegram** (non WhatsApp).
Parte telefonica: **esterna**, comunica via **webhook** con l'harness.

---

## 1. Quadro demo vs capability esistenti

| Atto | Cosa chiede la demo | Stato nel repo |
|---|---|---|
| 1 | Chiamata in ingresso → assistente risponde, cattura consenso + preferenza contatto + dati persona | **Manca webhook telefonico**; nessun campo preferenza/opt-in |
| 2 | Copilot analizza pubblico (storico, interessi, conversazioni, acquisti, preferenze, segmenti) | **Coperto** (skill `crm` + segmenti + interazioni) |
| 3 | Orchestrazione: Telegram a chi sceglie Telegram, email a chi sceglie email; agente marketing | **Metà**: campagne email (SES) esistono; manca trasporto Telegram + routing per canale |
| 4 | Cliente riceve messaggio Telegram, conversa, acquista (link) | **Base** (ingestione eventi Purchase); manca webhook Telegram conversazione |
| 5 | Richiama, assistente lo riconosce e sa dello stato ordine/corriere | **Manca** modello commerce + identità per numero + memoria cross-canale |

### Capability già presenti (verificato sul codice)
- CRM in DuckDB: `people`, `company`, `interaction`, `segment`, `campaign`, `campaign_send` (plus `email_thread`/`email_message`/`calendar_event`).
- Copilot = chat con l'agente + skill `crm` (`database-crm-system`): query DuckDB, report `.report.json`, segmenti, campagne.
- Segmentazione: builder demografico + condizioni eventi (`apps/web/app/components/crm/segments/`, `apps/web/lib/segments.ts`).
- Campagne email (AWS SES): coda, stati, retry, webhook SNS bounce/complaint (`apps/web/lib/campaigns.ts`).
- Ingestione eventi CDP (`interaction`, type `Purchase`) + web tracker anon→identificato (`apps/web/app/api/crm/events/route.ts`, `/api/events/collect`, shadow+merge).
- **Canale Telegram outbound: implementato nel runtime openclaw (dependency), NON in codice primo-partito.** Vedi §3.

---

## 2. Buchi rispetto alla demo

1. **Webhook di integrazione telefonica (buco critico — Atti 1, 4, 5).**
   Modello: la parte telefonica fa l'AI della conversazione; la Crm-A Console **non pilota la chiamata**. Manca l'interfaccia di eventi: `inbound` (chi chiama → lookup/crea Persona + contesto), `completed` (fine chiamata → registra `interaction` Call + aggiorna anagrafica), `message` (Telegram in ingresso → contesto prodotto). Manca anche il client outbound verso il provider (`/outbound/dial`, `/outbound/telegram`). **Non negoziabile**: la demo inizia e finisce lì.

2. **Preferenza di contatto + opt-in (Atti 1→3).**
   Nessun campo su `people` per "Telegram vs email" né consenso marketing. Serve campo enum "Preferred Contact Channel" + boolean "Marketing Opt-in", scritti dal webhook e letti dall'orchestrazione.

3. **Catalogo prodotti + ordini (Atti 2, 3, 5).**
   Il demo cita Samsung Galaxy, data lancio, data acquisto, stato corriere, possessori del modello precedente, propensione. Non esistono `product`/`order`: gli acquisti sono solo righe generiche in `interaction` (type `Purchase`). Senza `order` con stato/delivery l'Atto 5 non è sostenibile.

4. **Campagne Telegram-native e routing per canale (Atto 3).**
   Le campagne sono solo email via SES. Serve: trasporto Telegram nel motore campagne (via send service del runtime), audience filtrata per `Preferred Contact Channel`, mark per canale.

5. **Identità/memoria cross-canale (Atto 5).**
   Il webhook deve risolvere la Persona **per numero** e, quando si raccoglie numero/email, collegare la stessa persona alla sorgente Telegram. L'identità risolvibile esiste ma va cablata nel path del telefono.

6. **Seed/dati demo retail + runbook.**
   Il seed attuale è generico (5 persone/3 aziende). Serve scenario retail riproducibile (catalogo, date lancio, Lorenzo, ordini con delivery, conversazioni, segmento).

7. **(Non bloccanti, da `todo.md`)** MCP per integrazioni, ElevenLabs (voce), UX chat (live thinking, model picker), skill docs Apollo/Exa.

---

## 3. Nota di verifica su Telegram outbound

- `src/infra/outbound/deliver.ts` è uno **stub di tipi per i test** — tutti i canali sono campi `Optional` identici; commento: *"full implementation may live in upstream"*.
- L'implementazione reale è nel **runtime openclaw** (`node_modules/openclaw`):
  - `extensions/telegram/src/channel.ts` — plugin canale completo (account/bot token, onboarding, pairing, `getChatChannelMeta("telegram")`).
  - `dist/plugin-sdk/infra/outbound/` — sottosistema outbound: `outbound-send-service`, `delivery-queue`, `bound-delivery-router`, `channel-adapters`, `target-resolver`.
- Conseguenza: **non va costruito l'outbound Telegram**, va **cablate l'invocazione del send service del runtime** dal motore campagne e dal webhook. Per WhatsApp lo stesso lavoro non avrebbe nemmeno il lato canale/credenziali nella dipendenza.

---

## 4. Piano (ordinato per valore/rischio)

### Fase 0 — Contratto webhook con la parte telefonica (DONE)
Decisioni chiuse (dal committente):
- **Turno/ruolo**: la parte telefonica pilota la conversazione; la Console non conversa in tempo reale.
- **Auth**: solo Bearer token.
- **Outbound**: entrambi (telefono e Telegram) via endpoint del provider; la Console è il client (`/outbound/dial`, `/outbound/telegram`).

> Contratto dettagliato (schema JSON ingress/outgress, errore, idempotenza, mappa demo): vedi `WEBHOOK-PHONE-CONTRACT.md`.

### Fase 1 — Webhook di integrazione + identità (DONE)
- `POST /api/webhooks/phone` — `action` `inbound`/`completed`/`message`, auth Bearer, idempotenza per callId. `apps/web/app/api/webhooks/phone/route.ts`.
- Identità per numero + contesto: `apps/web/lib/phone-webhook.ts`; helper in `apps/web/lib/events.ts` (`findPersonIdByPhone`, `createPersonFromPhone`, `updatePersonFields`).
- Client outbound: `apps/web/lib/phone-outbound.ts` (`/outbound/dial`, `/outbound/telegram`).
- Test: 8 (route) + 6 (outbound) + 6 (events commerce) verdi.

### Fase 2 — Campi preferenza + opt-in su `people` + seeding retail (DONE)
- Campi `Preferred Contact Channel` + `Marketing Opt-in` in `PEOPLE_NEW_FIELDS` (`workspace-schema-migrations.ts`), scritti dal webhook.
- Seed demo idempotente: `POST /api/demo/seed` (`apps/web/app/api/demo/seed/route.ts`): catalogo Galaxy, contatti con preferenze, ordine Lorenzo, segmento lancio.

### Fase 3 — Modello commerce (product/order) + ingestione (DONE)
- Oggetti `product` + `order` in `NEW_OBJECTS` (+ `ONBOARDING_OBJECT_IDS`, `CrmFieldMaps`, `VIEW_NAMES`, `SEED_OBJECT_IDS`).
- `createProduct`/`createOrder`/`findProductIdBySku` in `events.ts`; contesto Atto 5 legge `lastOrder` (stato/corriere/delivery).

### Fase 4 — Campagne multicanale
- **Telegram via openclaw (decisione)**: il provider NON invia Telegram → l'outbound Telegram è dell'harness via runtime openclaw. Primitiva documentata consegnata: `apps/web/lib/openclaw-send.ts` (`deliverToSession`, `chat.send` con `deliver:true` su sessione per contatto `phone:<e164>`); testata.
- Resta: cablare il routing per `Preferred Contact Channel` nel motore campagne (audience + worker). Email→SES. **Prerequisito runtime**: gateway + bot Telegram connessi (non verificabile qui).

### Fase 5 — Runbook demo + rifiniture presentabilità
- Script della demo atto-per-atto, dati pre-seed; item `todo.md` che contano a schermo (live thinking, model picker) se il tempo lo consente.

---

## 5. Decisioni (chiuse in Fase 0)

1. **Ruolo**: la parte telefonica pilota la conversazione; la Console non conversa in tempo reale (solo lookup + registrazione + orchestrazione).
2. **Outbound**: telefono e Telegram via endpoint del provider (`/outbound/dial`, `/outbound/telegram`); la Console è il client.
3. **Auth webhook**: solo Bearer token (constant-time), niente HMAC.

---

## 6. Conclusione

Implementazione completa delle Fasi 0–5. Il collo di bottiglia (contratto + webhook telefonico) è risolto e testato; Telegram outbound è via openclaw (runtime), il dial telefonico via provider. Per l'invio Telegram dal vivo serve un bot/gateway connesso. Guida operativa per la presentazione: `DEMO-RUNBOOK.md`.

---

## 7. Stato lavori + istruzioni per la prossima sessione

### Fatto (committato su `main`, fork TopCS/crmaconsole)
- **RFW Fase 0–5**: webhook telefono (inbound/completed/message, Bearer, idempotenza), identità per numero, campagne SES, modello commerce (product/order), seed demo, runbook. 
- **NLPearl Fase A–E**: client v2 tipizzato + status mapping; webhook esiti call/lead → `interaction` + persona + `campaign_send` (External ID); campagna telefonica (Pearl lifecycle, routing `Preferred Contact Channel`, pausa/riattiva); inbound customer-care (PreCallAPI lookup-only 404→branch sconosciuto); brief MD come istruzioni voce; card Integrations (credenziali + webhook URL copy); client validato LIVE (creazione Pearl paused OK).
- **Script**: `scripts/nlpearl-e2e.sh` (orchestra il collaudo E2E).

### In sospeso (prossima sessione)
1. **Origine pubblica dei callback (GATE)** — senza un URL pubblico raggiungibile da NLPearl, i callback non sono collaudabili. Opzioni: Tailscale funnel su :3100 (`CRM_A_CONSOLE_PUBLIC_URL`), tunnel path-scoped, o deploy con origin pubblica. Verificare con `curl` esterno verso `/api/nlpearl/webhook/call?token=...`.
2. **E2E live** — `bash scripts/nlpearl-e2e.sh`: `--check` → `--create-inbound` → `--create-campaign` → (solo con numero di test tuo) `--send-lead` → `--activate` → verifica esito via webhook (interaction + `campaign_send.Status`). Mai usare numeri seed/demo.
3. **Pulizia dashboard NLPearl** — rimuovere le 4 Pearl `OMP-Test-*` (paused) create durante il collaudo: `6a79f5dd13744b2317945739` (outbound), `6a79f52d13744b2317945734`, `6a79f4b6...`, `6a79f4da...` (inbound). L'API non espone DELETE (405).
4. **Lead/attivazione** — solo esplicito, su un numero che l'operatore controlla; burn crediti.

### Convenzioni chiave NLPearl (verificate live — non smarrirle)
- `direction` nei PhoneNumbers **non è** inbound/outbound; non tutti i numeri sono autorizzati outbound. Funzionante per entrambe: `686fd112a91849a9e59a5353` (+39654547159).
- `firstName`/`email` = variabili built-in (non dichiarabili); `variables` deve essere array non vuoto (custom operational, es. `customerNote` group 2).
- Creazione Pearl richiede `pearl.timeZone` (Windows), `pearl.companyDescription`, (inbound) `inbound.waitingSentence`. `POST /Pearl/Voice` risponde col Pearl ID come **plain text**.
- Voce italiana auto: `resolveVoiceId` → `691c9263f52bb9e1b5b5d1f1` (Tommaso); override `NLPEARL_VOICE_ID` o campo Voice ID in Integrations.

### Variabili richieste (.env)
`CRM_A_PHONE_WEBHOOK_SECRET`, `NLPEARL_ACCOUNT_ID`, `NLPEARL_SECRET_KEY`, `CRM_A_CONSOLE_PUBLIC_URL` (per callback). Opzionali: `NLPEARL_BASE_URL`, `NLPEARL_VOICE_ID`.

### Verifica suite
`pnpm --dir apps/web test` (o i singoli `lib/*.test.ts` / `app/api/nlpearl/*`). Tsc: `tsc --noEmit -p apps/web/tsconfig.json`. Lint: `npx oxlint --type-aware apps/web/...`.
