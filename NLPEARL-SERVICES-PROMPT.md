# NLPearl — Prompt di generazione: i due servizi di chiamata per Crm-A Console

> **Uso:** incollare questo documento nell'AI/builder NLPearl per generare i due servizi (agent vocali):
> **1) INBOUND** — servizio clienti (il cliente chiama la Console) → lo crea NLPearl (dashboard).
> **2) OUTBOUND** — campagna di lancio (la Console chiama i clienti) → lo crea la Console via API (il payload qui sotto è il contratto; NLPearl lo valida/usa come template).
>
> **Prima di incollarlo, sostituire i segnaposto:**
> - `{{BASE_URL}}` → origin pubblica della Console, es. `https://crm-a-console.mio-tailnet.ts.net` (Tailscale funnel). **Niente** slash finale.
> - `{{TOKEN}}` → `CRM_A_PHONE_WEBHOOK_SECRET` (stesso segreto della Console; va come query param `?token=…`).
> - `{{ACCOUNT_ID}}`, `{{SECRET_KEY}}` → credenziali NLPearl (auth API: `Bearer {{ACCOUNT_ID}}:{{SECRET_KEY}}`).
> - `{{INBOUND_PHONE_ID}}` → phone number ID autorizzato per l'inbound.
> - `{{OUTBOUND_PHONE_ID}}` → phone number ID **verificato per l'outbound** (non tutti lo sono — errore `400 "not authorized for outbound calls"`).
> - `{{VOICE_ID}}` → voice italiana dell'account (o `NLPEARL_VOICE_ID`).

---

## 1. Ruolo

Sei il configuratore AI di NLPearl.AI. Genera **due servizi di chiamata** (Voice Pearl, node graph) per
**Crm-A Console**, un CRM-AI locale. Divisione dei ruoli:
- **NLPearl = trasporto telefonico + AI della conversazione** (esegue la chiamata, parla, raccoglie dati).
- **Crm-A Console = cervello CRM** (identità, storico ordini, consensi, registrazione esiti) — esposta a
  `{{BASE_URL}}`, protetta da webhook con `?token={{TOKEN}}`.

Tutte le conversazioni sono in **italiano**, tono professionale e cordiale, mai aggressivo.

---

## 2. Regole condivise (vincolate, verificate in produzione)

1. **Auth API NLPearl**: `Authorization: Bearer {{ACCOUNT_ID}}:{{SECRET_KEY}}` (un'unica stringa `id:secret`).
2. **Webhook della Console**: auth via query param `?token={{TOKEN}}` (niente header custom). Rispettare
   **esattamente** i payload sotto; risposta attesa `200` (altrimenti `401`/`400`).
3. **Numeri**: E.164 (`+393331234567`, mai senza prefisso).
4. **Nodo**: esattamente **un EndCall** (nodeType 100); **un OpeningSentence** (nodeType 2) per ramo
   (con PreCallAPI: max 1–2); ogni `nodeId` unico ≤ 20 caratteri; ogni `toNodeId` deve esistere;
   i `name` delle transizioni unici nel nodo.
5. **Variabili**: `firstName` ed `email` sono **built-in delle lead / del PreCallAPI — NON ridichiararle**
   in `variables`. L'array `variables` deve essere **non vuoto** (usare variabili operational custom).
   I dati di lead vanno in `callData`, mai in `variables`.
6. **Creazione Pearl** richiede: `pearl.timeZone` (formato Windows, es. `Romance Standard Time`),
   `pearl.companyDescription`; l'inbound richiede anche `inbound.waitingSentence`.
7. `POST /Pearl/Voice` risponde con **Pearl ID come plain text** (non JSON).
8. La Console crea le Pearl **PAUSED**: nessuna chiamata parte senza attivazione esplicita.
9. **Consenso**: il marketing opt-in va sempre chiesto esplicitamente a voce; mai presumere.

---

## 3. Servizio 1 — INBOUND (customer care): lo crea NLPearl in dashboard

**Nome suggerito:** `Crm-A Inbound Care` — **type 1 (Inbound)**.

### Comportamento
1. **PreCallAPI** (prima di parlare): `GET {{BASE_URL}}/api/nlpearl/precall?token={{TOKEN}}&phone={phoneNumber}`
   - `200` + `{"data":{"firstName":"Lorenzo","context":"…"}}` → **cliente noto** → ramo `apiResult: 1`.
   - `404` → **cliente ignoto** → ramo `apiResult: 2`.
2. **Cliente noto**: salutare per nome e usare il contesto (`context`) — es. stato ordine/consegna,
   ultimo acquisto, preferenze. **Cliente ignoto**: saluto generico, raccogliere la richiesta.
3. Rispondere sulle domande prodotto usando il **brief** passato nelle istruzioni (caratteristiche,
   confronto col modello precedente, promo, link d'acquisto).
4. A fine chiamata NLPearl invia il **call webhook** (contratto §6) con trascrizione, summary e
   `collectedInfo` (es. consensi, interessi).

### Config (payload di creazione, `POST /Pearl/Voice`)
```jsonc
{
  "name": "Crm-A Inbound Care",
  "pearl": {
    "companyName": "Crm-A",
    "companyDescription": "Servizio clienti gestito da Crm-A Console.",
    "agentPersonality": "Professional and warm",
    "modelType": 3,
    "agents": [{ "name": "Agent", "voiceId": "{{VOICE_ID}}" }],
    "timeZone": "Romance Standard Time",
    "nodes": [
      { "nodeId": "lookup", "name": "Lookup cliente", "nodeType": 3,
        "apiSettings": {
          "name": "Contesto CRM",
          "method": 1,
          "endpointUrl": "{{BASE_URL}}/api/nlpearl/precall?token={{TOKEN}}&phone={phoneNumber}",
          "description": "Recupera identità e ordini del cliente dal CRM.",
          "outputBody": [
            { "key": "firstName", "variableId": "firstName" },
            { "key": "context", "variableId": "context" }
          ]
        },
        "transitions": [
          { "name": "Cliente trovato", "toNodeId": "openKnown", "apiResult": 1 },
          { "name": "Cliente non trovato", "toNodeId": "openUnknown", "apiResult": 2 }
        ] },
      { "nodeId": "openKnown", "name": "Saluto cliente noto", "nodeType": 2,
        "script": "Buongiorno {firstName}, come posso aiutarla?",
        "instructions": "Usa il contesto del cliente per personalizzare la conversazione. Se il cliente parla di un ordine, usa i dati di consegna forniti.",
        "transitions": [{ "name": "ok", "toNodeId": "speak" }] },
      { "nodeId": "openUnknown", "name": "Saluto nuovo cliente", "nodeType": 2,
        "script": "Buongiorno, come posso aiutarla?",
        "transitions": [{ "name": "ok", "toNodeId": "speak" }] },
      { "nodeId": "speak", "name": "Conversazione", "nodeType": 10,
        "script": "Come posso esserle utile oggi?",
        "instructions": "Rispondi sulle domande prodotto usando il contenuto dell'offerta fornito.",
        "transitions": [{ "name": "fine", "toNodeId": "end" }] },
      { "nodeId": "end", "name": "Fine", "nodeType": 100, "transitions": [] }
    ]
  },
  "variables": [{ "id": "context", "name": "Contesto CRM", "group": 1 }],
  "inbound": {
    "phoneNumberId": "{{INBOUND_PHONE_ID}}",
    "totalAgents": 5,
    "callWebhookUrl": "{{BASE_URL}}/api/nlpearl/webhook/call?token={{TOKEN}}",
    "waitingSentence": "La preghiamo di attendere, un operatore è subito con lei."
  }
}
```

---

## 4. Servizio 2 — OUTBOUND (campagna di lancio): lo crea la Console via API

**Nome suggerito:** `Campaign <id>` — **type 2 (Outbound)**. La Console lo crea **per ogni campagna**
dall'agente in chat (`crm_a_phone_campaign → create`), sempre **PAUSED**. Questo blocco è il **contratto**
che la Console invia: generare/validare il servizio su questi parametri.

### Comportamento
1. Apertura con il nome del lead: `"Buongiorno {firstName}, una chiamata per conto di Crm-A Console."`
2. Presentare l'offerta leggendo le **istruzioni del nodo Dialogue** (il "Voice Brief": caratteristiche,
   confronto col modello precedente, vantaggi/limiti, promo lancio, link d'acquisto). Improvvisare, non leggere.
3. **Chiedere esplicitamente il consenso** marketing e il canale preferito; se rifiuta, chiudere con cortesia.
4. Inviare i webhook di **call** e **lead** (§6) con summary + `collectedInfo`.

### Payload di creazione (`POST https://api.nlpearl.ai/v2/Pearl/Voice` — CURL)
```bash
curl -s -X POST https://api.nlpearl.ai/v2/Pearl/Voice \
  -H "Authorization: Bearer {{ACCOUNT_ID}}:{{SECRET_KEY}}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Campaign a1b2c3d4",
    "pearl": {
      "companyName": "Crm-A",
      "companyDescription": "Campagna chiamante gestita da Crm-A Console.",
      "agentPersonality": "Professional and warm",
      "modelType": 3,
      "agents": [{ "name": "Agent", "voiceId": "{{VOICE_ID}}" }],
      "timeZone": "Romance Standard Time",
      "nodes": [
        { "nodeId": "open", "name": "Saluto", "nodeType": 2,
          "script": "Buongiorno {firstName}, una chiamata per conto di Crm-A Console.",
          "transitions": [{ "name": "ok", "toNodeId": "speak" }] },
        { "nodeId": "speak", "name": "Offerta", "nodeType": 10,
          "script": "Vorremmo presentarle una nuova offerta.",
          "instructions": "Contenuto offerta da comunicare: [VOICE BRIEF ≤ 250 CARATTERI TOTALI: NLPearl limita le istruzioni del nodo — la Console condensa il brief su confine di frase; il confronto completo resta nel campo Body della campagna]",
          "transitions": [{ "name": "end", "toNodeId": "end" }] },
        { "nodeId": "end", "name": "Fine", "nodeType": 100, "transitions": [] }
      ]
    },
    "variables": [{ "id": "customerNote", "name": "Nota", "group": 2 }],
    "outbound": {
      "phoneNumberId": "{{OUTBOUND_PHONE_ID}}",
      "totalAgents": 1,
      "maximumCallAttempts": 3,
      "minimumRetryIntervalHours": 2,
      "callingHours": [
        { "day": 1, "start": "09:00", "end": "18:00" },
        { "day": 2, "start": "09:00", "end": "18:00" },
        { "day": 3, "start": "09:00", "end": "18:00" },
        { "day": 4, "start": "09:00", "end": "18:00" },
        { "day": 5, "start": "09:00", "end": "18:00" }
      ],
      "timeZone": "Romance Standard Time",
      "callWebhookUrl": "{{BASE_URL}}/api/nlpearl/webhook/call?token={{TOKEN}}",
      "leadWebhookUrl": "{{BASE_URL}}/api/nlpearl/webhook/lead?token={{TOKEN}}"
    }
  }'
```
→ risposta: **Pearl ID** (plain text). Attivazione: `PUT /Pearl/{id}/Active {"isActive": true}` (solo dopo conferma operatore).

### Lead (la Console le enqueua)
```bash
curl -s -X POST https://api.nlpearl.ai/v2/Outbound/{pearlId}/Lead \
  -H "Authorization: Bearer {{ACCOUNT_ID}}:{{SECRET_KEY}}" \
  -H "Content-Type: application/json" \
  -d '{
    "phoneNumber": "+393331234567",
    "externalId": "3f2c1a5e-0000-4000-8000-000000000000",
    "callData": { "firstName": "Lorenzo", "email": "lorenzo@example.com" }
  }'
```
- `externalId` = UUID della riga `campaign_send` in Console → usato dal lead webhook per aggiornare lo stato.

---

## 5. Webhook della Console — contratti (le "disposizioni CURL" da rispettare)

### 5.1 PreCallAPI (solo INBOUND) — GET
```bash
curl -s "{{BASE_URL}}/api/nlpearl/precall?token={{TOKEN}}&phone=%2B393331234567"
# 200 → {"data":{"firstName":"Lorenzo","context":"Cliente esistente: Lorenzo, ha acquistato Galaxy S26 il 12/07, consegna in corso. Preferenza telefono, opt-in marketing già dato."}}
# 404 → {"error":"not_found"}   (numero sconosciuto → ramo apiResult 2)
# 401 → token errato/mancante
```

### 5.2 Call webhook (IN + OUT) — POST `{{BASE_URL}}/api/nlpearl/webhook/call?token={{TOKEN}}`
Payload nativo NLPearl (V2 Call Webhook):
```jsonc
{
  "id": "vc-20260817-0001",
  "pearlId": "<pearlId>",
  "startTime": "2026-08-17T10:00:00Z",
  "conversationStatus": "Success",     // enum: NeedRetry|InCallQueue|OnCall|VoiceMailLeft|Success|NotSuccessful|Completed|Unreachable|Blacklisted|QueueAbandon|Error
  "status": "Completed",               // InProgress|Completed|Busy|Failed|NoAnswer|Canceled
  "from": "+39654547159",
  "to": "+393331234567",
  "name": "Lorenzo",
  "duration": 160,
  "recording": "https://...",
  "transcript": [ { "speaker": "assistant", "text": "..." }, { "speaker": "customer", "text": "..." } ],
  "summary": "Cliente interessato al lancio Galaxy S27, consenso marketing confermato.",
  "collectedInfo": [ { "name": "marketingOptIn", "value": "true" } ],
  "overallSentiment": "positive",
  "leadId": "lead-123"
}
```
Risposta attesa `200`: `{"ok":true,"interactionId":"...","personId":"..."}` (idempotente per `id`).

### 5.3 Lead webhook (solo OUT) — POST `{{BASE_URL}}/api/nlpearl/webhook/lead?token={{TOKEN}}`
```jsonc
{
  "id": "lead-123",
  "pearlId": "<pearlId>",
  "externalId": "3f2c1a5e-0000-4000-8000-000000000000",
  "phoneNumber": "+393331234567",
  "timeZone": "Europe/Rome",
  "status": "Success",                 // 1 New … 100 Success, 130 Completed, 150 Unreachable, 220 Blacklisted, 300 QueueAbandon, 500 Error
  "callsId": ["vc-20260817-0001"],
  "callData": { "firstName": "Lorenzo", "email": "lorenzo@example.com" },
  "collectedData": { "marketingOptIn": "true" }
}
```
Risposta attesa `200`: `{"ok":true,"interactionId":"...","personId":"...","sendStatus":"..."}`.
La Console aggiorna lo stato della campagna tramite `externalId`.

---

## 6. Criteri di accettazione (verificare prima di attivare)

- [ ] **INBOUND**: PreCallAPI risponde `200` con `firstName`+`context` per un numero noto e `404` per uno ignoto; i rami `apiResult 1/2` portano ai saluti giusti; `waitingSentence` e `timeZone` presenti; la creazione va in **Paused** e si attiva solo a valle di una chiamata di prova.
- [ ] **OUTBOUND**: `POST /Pearl/Voice` con il payload §4 crea la Pearl **Paused** e restituisce l'ID come plain text; il lead con `callData.firstName` fa aprire la chiamata con `"Buongiorno {firstName}…"`; le istruzioni del nodo `speak` contengono il Voice Brief.
- [ ] **Webhook**: call e lead arrivano con i payload §5; la Console risponde `200`; retry di un payload identico → `200` idempotente, nessun doppione.
- [ ] **Consenso**: l'AI chiede esplicitamente marketing opt-in + canale preferito; senza consenso non registra nulla di più.
- [ ] Numeri E.164; `variables` non ridichiara `firstName`/`email`; esattamente un EndCall per servizio.

---

## 7. Output richiesto

1. **Servizio 1 (INBOUND)**: configurazione completa pronta da creare in dashboard NLPearl (nodi, variabili, impostazioni, URL webhook già compilati con `{{BASE_URL}}`/`{{TOKEN}}`).
2. **Servizio 2 (OUTBOUND)**: conferma/validazione del payload §4 come template del servizio, con gli stessi URL webhook.
3. Per ciascuno: le stringhe conversazionali italiane di apertura/chiusura e la lista dei punti del Voice Brief da coprire.
