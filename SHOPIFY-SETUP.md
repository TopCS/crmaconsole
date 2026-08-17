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
  "Raggiungibilità"). Il webhook concorda con l'origin `https://crm-a-console.<tailnet>.ts.net`.
- `CRM_A_PHONE_WEBHOOK_SECRET` già valorizzato (il webhook accetta anche `?token=`).

## 1. Dev store + prodotto

1. Shopify Partners → **Stores** → **Add store** → *Development store* (nome es. `crm-a-demo-store`).
2. Nel pannello admin dello store: **Products → Add product**:
   - Title: `Samsung Galaxy S26`
   - SKU: `SAM-S26` ⚠️ **deve coincidere** con lo SKU del catalogo CRM (il webhook linka l'ordine al prodotto per SKU).
   - Price: `999.00`
   - Status: Active.

## 2. App custom + webhook

1. Admin store → **Settings → Apps and sales channels → Develop apps → Create an app**.
   Nome: `CRM-A Touchpoint`.
2. nell'app → **Configuration → Admin API access** → configura gli scopes:
   - `read_orders`, `write_orders` (per ricevere i webhook ordine).
   - Salva → **Install app** sullo store.
3. **Configuration → Webhooks** → **Add webhook** (per entrambi):
   | Evento | Endpoint |
   |---|---|
   | `Orders creation` (orders/create) | l'URL webhook della Console |
   | `Order fulfilled` (order/fulfilled) | l'URL webhook della Console |
   - API version a scelta (stabile).
   - L'URL lo trovi nella Console: **Integrations → card Shopify → "Webhook URL"** (o lo costruisci:
     `https://crm-a-console.<tailnet>.ts.net/api/webhooks/shopify`).
4. **API secret key**: nell'app → **API credentials → Admin API access token…** a fianco c'è
   **API secret key** (client secret). Copialo in `.env`:

   ```bash
   SHOPIFY_API_SECRET=<api-secret-key>
   SHOPIFY_STORE_DOMAIN=crm-a-demo-store.myshopify.com
   ```

   Con `SHOPIFY_API_SECRET` configurato, la Console **verifica l'HMAC** (`X-Shopify-Hmac-Sha256`)
   di ogni webhook. Se non lo imposti, il webhook accetta comunque `?token=` (fallback dev).

## 3. Collaudo (prep, NON sul palco)

Prima della demo verificare il percorso completo con il simulatore:

```bash
# 1) acquisto → crea il record
./scripts/shopify-demo-simulate.sh --webhook https://crm-a-console.<tailnet>.ts.net/api/webhooks/shopify
# → { ok:true, personId, matched:"created", eventId, orderId }

# 2) spedizione → aggiorna corriere + consegna sull'ordine
./scripts/shopify-demo-simulate.sh --webhook ... --fulfilled
```

Se `SHOPIFY_API_SECRET` è nell'ambiente, il simulatore firma con HMAC (come farebbe Shopify);
altrimenti usa `?token=`.

## 4. Demo live

1. In Shopify: crea il cliente che comprerà — **email e telefono devono essere quelli della persona
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
export SHOPIFY_API_SECRET=            # verifica HMAC dei webhook
export SHOPIFY_STORE_DOMAIN=          # es. crm-a-demo-store.myshopify.com
```