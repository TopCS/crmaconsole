---
name: shopify
description: "Shopify integration in Crm-A Console: the e-commerce touchpoint webhook (/api/webhooks/shopify — orders become CRM people), plus Admin API operations (products, orders, fulfillments) to prepare and drive the dev-store demo. Use when handling Shopify webhooks, mapping an order to a Person, verifying HMAC, creating/configuring the demo product or customer, fulfilling an order, or checking store status."
metadata: { "openclaw": { "inject": true, "emoji": "🛍️" } }
---

# Shopify in Crm-A Console

Shopify is the **e-commerce touchpoint**: a store purchase is what *materializes* the first CRM
record ("da un touchpoint nasce un cliente"). There are two distinct surfaces:

1. **Webhook touchpoint (CRM ingestion)** — `/api/webhooks/shopify`. Shopify → Console. An
   `orders/create` turns an order into a Person + `Purchase` event + order. This is the demo's Atto 0.
2. **Admin API (store side)** — Console → Shopify. Products/orders/fulfillments CRUD, used for
   dev-store prep and the fulfillment beat. Helper CLIs: `skills/shopify/scripts/`.

## Credentials — keep webhook secret vs admin token separate

| Env | Uses | What it is |
|---|---|---|
| `SHOPIFY_STORE_DOMAIN` | display + Admin API host | e.g. `crm-a-demo-store.myshopify.com` |
| `SHOPIFY_API_SECRET` | **webhook HMAC** verification (`X-Shopify-Hmac-Sha256`) | app client secret |
| `SHOPIFY_ADMIN_TOKEN` | Admin API (`X-Shopify-Access-Token`) | app Admin API access token, `shpat_…` |
| `SHOPIFY_API_VERSION` | Admin API | default `2024-10` |

`SHOPIFY_API_SECRET` (HMAC, in `.env`/Integrations card) and `SHOPIFY_ADMIN_TOKEN` (Admin API, in
the shell/`.env` for the agent) are **different credentials for different purposes** — never swap them.

---

## 1. Webhook touchpoint (orders → CRM people)

### Endpoint
```
POST /api/webhooks/shopify
```
Auth (one of):
- **HMAC** (preferred, when `SHOPIFY_API_SECRET` set): verify `X-Shopify-Hmac-Sha256` =
  `base64(HMAC-SHA256(rawBody, apiSecret))` over the **exact raw body**. Constant-time.
- **fallback** `?token=` equal to the console webhook secret (dev/prep/simulator).

Topics accepted: `orders/create`, `orders/paid`, `order/fulfilled`. Anything else → `400`.

### Payload → CRM mapping (`@/lib/shopify.mapShopifyOrder`)
- Identifiers (normalized): email → `customer.email || order.email` (lowercased); phone →
  `customer.phone || order.phone` (E.164-ish, + kept); name → `first_name last_name`.
- Order: `id`, `created_at`, `total_price`/`current_total_price`, `currency`, `financial_status`
  (→ `Paid`/`Refunded`/`Pending`), `line_items[{sku,title,quantity,price}]`, `fulfillments[]`,
  `order_status_url`.

### Person resolution ("confrontando i vari campi")
Order of match: **email → phone → create**. `matched` in the response:
- `created` — no record, profile built from the order.
- `matched_by_email` / `matched_by_phone` — found by that key; **gap-fill only empty** Full Name /
  Phone / Email (never overwrite a differing identifier → safe merge).

### GDPR — a purchase is identity ONLY
An `orders/create` **never** writes marketing consent or a preferred contact channel. Only
Full Name / Email / Phone (+ Purchase event + order). Marketing opt-in and channel are **explicit
operator actions** downstream (chat/UI). Violating this (auto-opt-in from an order) is a consent
violation — do not do it.

### order/fulfilled — find-only, no phantom records
`applyShopifyFulfillment` looks up the Person by email→phone **without creating** (a fulfillment
arriving without a prior `orders/create` — retry, manual admin fulfill, race — must never spawn a
bare record). Updates courier + `Delivery Status` on the person's **latest order** (friendly text
mapped from `fulfillments[].status`: `in_transit` → "Corriere in carico…", `delivered` → "Consegnato.").

### Idempotency & response
Idempotent by Shopify order id (stored in interaction Properties) — a duplicate delivery returns the
already-recorded event, no double writes.

`orders/create` → `201` `{ ok, personId, matched, createdPerson, eventId, orderId, productId, duplicate }`
`order/fulfilled` → `200` `{ ok, personId, updated }`

### Verification (prep, not on stage)
```bash
./scripts/shopify-demo-simulate.sh --webhook https://crm-a-console.<tailnet>.ts.net/api/webhooks/shopify
./scripts/shopify-demo-simulate.sh --webhook ... --fulfilled
```
Signature mode automatico: HMAC se `SHOPIFY_API_SECRET` è in env, altrimenti `?token=`.

### Rules
- Purchase → identity/order/event only. Consent stays operator-owned.
- `order/fulfilled` find-only: no create, no gap-fill of the anagraphic.
- Product by SKU: `orders/create` resolves the catalog product by `line_items[].sku`; unknown SKU →
  auto-create product (`Status: Available`).
- Never fabricate a demo webhook on stage; the script above is prep/verification only.

---

## 2. Admin API (store side / demo prep)

Base (GraphQL): `POST https://{SHOPIFY_STORE_DOMAIN}/admin/api/{version}/graphql.json`
Header: `X-Shopify-Access-Token: {SHOPIFY_ADMIN_TOKEN}`, `Content-Type: application/json`.
REST base: `https://{SHOPIFY_STORE_DOMAIN}/admin/api/{version}/`.

### Chat tool: `shopify_admin`
The `shopify_admin` tool is registered by `extensions/crm-a-shopify-admin` when
`CRM_A_PHONE_WEBHOOK_SECRET` is available. It calls the local
`POST /api/shopify/admin` route; the Admin token never leaves the server.

Supported actions:
- `store-info` — read store name/domain/plan.
- `list-products` — list products; optional `limit` and Shopify `query`.
- `list-orders` — list recent orders; optional `limit` and `status`.
- `ensure-product` — find by SKU or create a product; requires `confirm: true`.
- `fulfill-order` — create a fulfillment with carrier/tracking number; requires `confirm: true`.

The tool is the preferred chat/demo surface. Use the Python helpers below for
explicit prep scripts or when the chat runtime is unavailable.

### Recipes relevant to the demo
**Store sanity:**
```bash
curl -s -X POST "https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-10/graphql.json" \
  -H "X-Shopify-Access-Token: ${SHOPIFY_ADMIN_TOKEN}" -H "Content-Type: application/json" \
  -d '{"query":"{ shop { name primaryDomain { host } } }"}'
```
**Ensure product exists by SKU** (List → search → create if missing; the webhook links orders to the
catalog by this SKU):
```graphql
mutation { productCreate(input: {
  title: "Samsung Galaxy S26"
  status: ACTIVE
  variants: [{ price: "999.00", sku: "SAM-S26", inventoryQuantity: 10 }]
}) { product { id title } userErrors { field message } } }
```
**Fulfill an order** (the Atto 0 memory beat: marks shipped → fires `order/fulfilled` → CRM updates
delivery). Use the helper:
```bash
python3 skills/shopify/scripts/shopify_orders.py list --limit 5        # find the order
python3 skills/shopify/scripts/shopify_orders.py fulfill --id gid://shopify/Order/1 \
  --tracking-number DEMO-S26 --carrier GLS
```
(The helper fetches line items and posts a real fulfillment, which triggers the webhook.)

### Helper CLIs (`skills/shopify/scripts/` — python3, stdlib only)
Config lookup order: env (`SHOPIFY_STORE_DOMAIN`/`SHOPIFY_STORE`, `SHOPIFY_ADMIN_TOKEN`/`SHOPIFY_TOKEN`,
`SHOPIFY_API_VERSION`, loaded from a local `.env` if present) → `~/.shopify/config.json`
(`{store,token,api_version}`).

| Script | Commands |
|---|---|
| `shopify_shop.py` | `store` — prints store name/domain/plan |
| `shopify_products.py` | `list`, `search`, `get --id`, `create --file`, `update --id --file`, `delete --id` |
| `shopify_orders.py` | `list [--limit --status]`, `get --id`, `fulfill --id --tracking-number --carrier` |
| `shopify_inventory.py` | `list [--limit]`, `adjust --level-id --delta`, `set --level-id --quantity` |
| `shopify_export.py` | `products [--format csv\|json --output]`, `orders [--format --output --date-from --date-to --status]` |

---

## Common pitfalls

1. **Webhook secret ≠ Admin token.** HMAC needs `SHOPIFY_API_SECRET`; Admin API needs
   `SHOPIFY_ADMIN_TOKEN` (`shpat_…`).
2. **HMAC over the exact raw body** — re-serializing JSON changes the signature. The route reads the
   raw text, so do the same when reproducing.
3. **Never auto-opt-in.** A purchase is identity only; consent is an explicit operator step.
4. **`order/fulfilled` must not create** — find+update latest order only.
5. **E.164** for phone lookups; email lowercased.
6. Order `id` arrives as a number from Shopify — treat it as string for idempotency.