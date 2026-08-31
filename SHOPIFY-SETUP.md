# Shopify dev store — setup del touchpoint e-commerce (demo "Rome Future Week")

Obiettivo: un acquisto nello store fa scattare un webhook che **crea il record CRM da zero**
("da un touchpoint nasce un cliente"). Nessun contatto pre-seeded: è il primo touchpoint a
materializzare la Persona + l'ordine + l'evento `Purchase`.

Il sistema lato Console è già implementato (`/api/webhooks/shopify`) e collaudabile col
simulatore `scripts/shopify-demo-simulate.sh`. Questo documento prepara il **live dev store**.

---

## 0. Prerequisiti

- **Account Shopify Partners** (gratuito) per aprire un dev store. Serve per creare un'app custom.
- Console raggiungibile: **Tailscale funnel** attivo (vedi `DEMO-PRESENTATION-SCRIPT.md` →
  "Raggiungibilità"). Origin pubblica attuale: `https://top-mgm-00-2.taileb6b.ts.net`.
- `CRM_A_PHONE_WEBHOOK_SECRET` già valorizzato (il webhook accetta anche `?token=`).

## 1. Dev store + prodotto

1. Shopify Partners → **Stores** → **Add store** → *Development store*.
   Store in uso per la demo: **`electronyca.myshopify.com`** ("Snow World").
2. Nel pannello admin dello store: **Products → Add product**:
   - Title: `Samsung Galaxy S26`
   - SKU: `SAM-S26` ⚠️ **deve coincidere** con lo SKU del catalogo CRM (il webhook linka l'ordine al prodotto per SKU).
   - Price: `999.00`
   - Status: Active.

> ⚠️ Prodotto **già creato** durante il setup (id `15692584976724`) — verificare solo che sia
> attivo e in stock prima della demo.

## 2. App custom + webhook

L'app dedicata **`CRM-A Touchpoint`** (client_id `e2f6ffbbb077827c83e124f380464b78`) è stata creata
via Shopify CLI (`~/shopify/crm-a-touchpoint/`) e la configurazione **già rilasciata**
(`crm-a-touchpoint-3`, attiva) con:

- scopes: `read_products, write_products, read_orders, write_orders`;
- webhook `orders/create` e `order/fulfilled` → `https://top-mgm-00-2.taileb6b.ts.net/api/webhooks/shopify`;
- `application_url` e redirect sul funnel.

**Resta da fare (manuale, richiede il login Shopify):**

1. **Installare l'app sullo store**: Partner Dashboard → Apps → `CRM-A Touchpoint` → **Manage app** →
   installa su `electronyca` (dev store), accettando gli scope.
2. **Copiare in `.env` il client secret della nuova app** (≠ quello dell'app precedente
   `mabina-ai-poc`; il client id è già corretto):
   ```bash
   SHOPIFY_API_SECRET=<api-secret-key della nuova app>   # da Partner Dashboard → API credentials
   ```
3. **Generare il token automaticamente** (nessun copia-incolla del token):
   ```bash
   ./scripts/shopify-fetch-admin-token.sh   # client-credentials grant → scrive SHOPIFY_ADMIN_TOKEN in .env
   ```
4. Riavviare la Console (`docker compose up -d --force-recreate crm-a-console`).

> I valori attuali in `.env` (`shpss_…`, `shpat_…`) appartengono ancora alla vecchia app
> `mabina-ai-poc`: funzionano per Admin API (prodotti), ma gli HMAC dei webhook della nuova app
> fallirebbero. Per la prova locale (simulatore) va bene; per la demo live aggiornarli.

## 3. Collaudo (prep, NON sul palco)

Prima della demo verificare il percorso completo con il simulatore:

```bash
# 1) acquisto → crea il record
./scripts/shopify-demo-simulate.sh --webhook https://top-mgm-00-2.taileb6b.ts.net/api/webhooks/shopify
# → { ok:true, personId, matched:"created", eventId, orderId }

# 2) spedizione → aggiorna corriere + consegna sull'ordine
./scripts/shopify-demo-simulate.sh --webhook https://top-mgm-00-2.taileb6b.ts.net/api/webhooks/shopify --fulfilled
```

Se `SHOPIFY_API_SECRET` è nell'ambiente, il simulatore firma con HMAC (come farebbe Shopify);
altrimenti usa `?token=`.

## 4. Demo live

1. In Shopify (store `electronyca.myshopify.com`): crea il cliente che comprerà — **email e telefono devono essere quelli della persona
   che la demo deve riconoscere** (Lorenzo: `lorenzo@example.com`, telefono = il numero del
   presentatore, così Atto 3/Atto 6 lo richiamano e il CRM lo riconosce).
2. Effettua il checkout e paga l'ordine SAM-S26 → il webhook `orders/create` parte →
   la Console **crea il profilo**, registra `Purchase`, materializza l'ordine.
3. (Beat di memoria) segna l'ordine come **evaso** in Shopify (courier GLS, in transito) →
   webhook `order/fulfilled` → l'ordine riceve corriere + stato di consegna.

## 5. Note importanti

- **Un acquisto materializza solo l'identità** (nome/email/telefono). NON scrive consenso marketing
  né canale preferito: quello lo decide l'operatore in console (beat di abilitazione al consenso).
- `matched` nella risposta: `created` (profilo nuovo) | `matched_by_email` | `matched_by_phone`.
- Idempotente per `id` ordine: un webhook ripetuto non duplica nulla.
- Prodotti sconosciuti (SKU non in catalogo) vengono creati automaticamente con `Status: Available`.

## 6. Variabili d'ambiente (`.env`)

```bash
export SHOPIFY_STORE_DOMAIN=electronyca.myshopify.com
export SHOPIFY_API_SECRET=            # HMAC webhook — della NUOVA app CRM-A Touchpoint (dopo install)
export SHOPIFY_ADMIN_TOKEN=           # Admin API shpat_… — della NUOVA app (dopo install)
export SHOPIFY_API_VERSION=2026-07
```