# Runbook — Demo "Rome Future Week" (Crm-A Console)

Eseguibile dalla suite integrata. Il provider telefonico fa l'AI della conversazione; la Crm-A Console è il cervello CRM (lookup, registrazione, orchestrazione) ed espone il webhook.

---

## 0. Prerequisiti

```bash
# 1) Segreto webhook (necessario per auth ingress + demo seed + campagne)
export CRM_A_PHONE_WEBHOOK_SECRET=<secret-demo>

# 2) Dial telefonico outbound (solo telefono; il provider la genera)
export CRM_A_PHONE_OUTBOUND_URL=https://<provider-outbound>
export CRM_A_PHONE_OUTBOUND_SECRET=<provider-secret>

# 3) Telegram outbound: canale telegram + bot connessi nel gateway openclaw
#    (openclaw.json → channels.telegram.token). NON passa dal provider.
```

Avvio console e **seed** dello scenario:
```bash
curl -X POST localhost:3100/api/demo/seed \
  -H "Authorization: Bearer $CRM_A_PHONE_WEBHOOK_SECRET"
# → products, people, order, segment
```

---

## Atto 1 — Primo contatto (chiamata in ingresso + consenso)

La parte telefonica chiama questi webhook; mostra lo scambio.

```bash
# 1a) in ingresso: numero sconosciuto → la Console crea la Persona + contesto
curl -sX POST localhost:3100/api/webhooks/phone \
  -H "Authorization: Bearer $CRM_A_PHONE_WEBHOOK_SECRET" -H 'content-type: application/json' \
  -d '{"action":"inbound","callId":"vc-1","from":{"phone":"+39311222333"}}'
# → { person: { id, matched:"created" }, context:"Nuovo contatto registrato…", callStatus:"continue" }

# 1b) fine chiamata: consenso + preferenza + dati → registra Call + aggiorna anagrafica
curl -sX POST localhost:3100/api/webhooks/phone \
  -H "Authorization: Bearer $CRM_A_PHONE_WEBHOOK_SECRET" -H 'content-type: application/json' \
  -d '{"action":"completed","callId":"vc-1","from":{"phone":"+39311222333"},"durationSec":150,
       "data":{"name":"Lorenzo","email":"lorenzo@example.com","preferredContact":"telegram",
               "marketingOptIn":true,"summary":"Vuole essere avvisato al lancio Galaxy"}}'
# → { ok, interactionId, personId, actions:["interaction_recorded","person_updated"] }
```

Verifica in console: profilo "Lorenzo" (Preferenza=telegram, Opt-in=true) + interazione `Call` nella timeline.

---

## Atto 2 — Il CRM diventa memoria (Copilot)

Aprire il Copilot (chat) e chiedere, come nel demo:
> "Stiamo lanciando il nuovo Samsung Galaxy. Qual è il pubblico migliore a cui proporlo?"

Il Copilot usa la skill `crm` sui dati seedati: segmento "Lancio Samsung Galaxy" (opt-in=true), acquirenti S26/S25 (ordini), preferenze di canale. Risponde con la lista; Lorenzo è incluso.

---

## Atto 3 — Orchestrazione (campagna multicanale)

**Passo 0 — Export del brief di marketing (contenuto per l'ambiente telefonico):**
La conoscenza del prodotto viaggia come MD importato nell'ambiente telefonico (che fa l'AI della conversazione), non come lookup a runtime.
```bash
curl -s -H "Authorization: Bearer $CRM_A_PHONE_WEBHOOK_SECRET" \
  "localhost:3100/api/marketing/brief?promotedSku=SAM-S27&previousSku=SAM-S26" \
  -o brief-galaxy-s27.md
# Contiene: prodotto+lancio, copy ufficiale (caratteristiche/differenze/vantaggi/limiti,
# promo, link acquisto), confronto vs S26, pubblico, esempio memoria Atto 5.
# → importare brief-galaxy-s27.md nell'ambiente telefonico (briefing dell'AI).
```

**Passo 1 — Invio multicanale per preferenza di canale:**
```bash
curl -sX POST localhost:3100/api/campaigns/send-multichannel \
  -H "Authorization: Bearer $CRM_A_PHONE_WEBHOOK_SECRET" -H 'content-type: application/json' \
  -d '{"segmentEntryId":"<id segmento>","subject":"Samsung Galaxy 27",
       "body":"Disponibile dal 18 ottobre. Promo per i primi clienti."}'
# → { sent, telegram: <a chi ha scelto telegram>, email: <a chi ha scelto email>, failed:[] }
```

- Telegram → runtime openclaw (sessione `phone:<e164>`, invio reale richiede bot connesso).
- email → SES (campagna esistente).

Mostra la segmentazione per canale: chi ha scelto Telegram riceve su Telegram, chi email su email.

---

## Atto 4 — Il cliente riceve il messaggio e conversa

L'ambiente telefonico risponde alla domanda del cliente usando il **brief MD importato all'Atto 3** (caratteristiche, differenze vs S26, vantaggi, limiti). La Console, su messaggio in ingresso, restituisce il contesto del cliente:
```bash
curl -sX POST localhost:3100/api/webhooks/phone \
  -H "Authorization: Bearer $CRM_A_PHONE_WEBHOOK_SECRET" -H 'content-type: application/json' \
  -d '{"action":"message","messageId":"tg-1","contact":{"phone":"+393312345678","name":"Lorenzo"},
       "text":"Grazie, l'"'"'offerta mi interessa. Vale la pena?"}'
# → { person: profilo cliente, context: contesto CRM (identità/storico/acquisti), replyFor:"message" }
#    Il contenuto del prodotto viene dal brief MD importato (Atto 3).
```

Acquisto → si registra (webhook `completed` con `data.order`, oppure evento `Purchase` via `/api/crm/events`).

---

## Atto 5 — Dopo l'acquisto (riconoscimento memoria)

La parte telefonica richiama `inbound` per Lorenzo (numero noto):
```bash
curl -sX POST localhost:3100/api/webhooks/phone \
  -H "Authorization: Bearer $CRM_A_PHONE_WEBHOOK_SECRET" -H 'content-type: application/json' \
  -d '{"action":"inbound","callId":"vc-5","from":{"phone":"+393312345678","name":"Lorenzo"}}'
# → { person: { name:"Lorenzo", lastOrder: { productName:"Samsung Galaxy S26",
#       orderedAt, status:"Shipped", courier:"GLS",
#       deliveryStatus:"Corriere in carico oggi; consegna prevista domani entro le 18" } },
#     context:"Cliente esistente: Lorenzo… ultimo acquisto: Samsung Galaxy S26… corriere GLS…" }
```

L'AI telefonica pronuncia "Bentornato Lorenzo… il corriere… consegna entro le 18".

---

## Config rapida
| Var | Ruolo |
|---|---|
| `CRM_A_PHONE_WEBHOOK_SECRET` | auth ingress + seed + campagne |
| `CRM_A_PHONE_OUTBOUND_URL` / `_SECRET` | dial telefonico (provider) |
| Telegram bot nel gateway | outbound Telegram (runtime) |
