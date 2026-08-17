#!/usr/bin/env bash
# Shopify webhook simulator — prep/verifica della demo, NON sul palco.
#
# Invia un webhook ordine (orders/create) — e opzionalmente lo stato di
# spedizione (order/fulfilled) — verso la Console, esattamente come farebbe
# uno Shopify dev store. Usato per collaudare il percorso
# "da un touchpoint nasce un record" prima della demo (la demo live userà la
# vendita vera nello store).
#
# Autenticazione:
#   - se SHOPIFY_API_SECRET è valorizzato (env o .env) → header HMAC
#     X-Shopify-Hmac-Sha256 (come fa Shopify).
#   - altrimenti → ?token= con il segreto webhook della console.
#
# Uso:
#   ./scripts/shopify-demo-simulate.sh --webhook http://localhost:3100/api/webhooks/shopify
#   ./scripts/shopify-demo-simulate.sh --webhook https://crm-a-console.<tailnet>.ts.net/api/webhooks/shopify --fulfilled
#
# Variabili attese: CRM_A_PHONE_WEBHOOK_SECRET (per ?token=), SHOPIFY_API_SECRET (opzionale, HMAC).

set -euo pipefail

WEBHOOK="http://localhost:3100/api/webhooks/shopify"
MODE="order"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --webhook) WEBHOOK="$2"; shift 2 ;;
    --fulfilled) MODE="fulfilled"; shift ;;
    *) echo "sconosciuto: $1" >&2; exit 1 ;;
  esac
done

# Carica .env se presente.
if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

if [[ -z "${CRM_A_PHONE_WEBHOOK_SECRET:-}" ]]; then
  echo "manca CRM_A_PHONE_WEBHOOK_SECRET (per ?token=)" >&2
  exit 1
fi

TOKEN_QS="?token=${CRM_A_PHONE_WEBHOOK_SECRET}"

# ── Payload ordine (cliente: Lorenzo — sostituire telefono/email con gli stessi del profilo) ──
PHONE="${DEMO_SHOPIFY_PHONE:-+393312345678}"
EMAIL="${DEMO_SHOPIFY_EMAIL:-lorenzo@example.com}"

order_payload=$(cat <<JSON
{
  "id": 4507894692,
  "order_number": 1001,
  "name": "#1001",
  "created_at": "2026-10-12T09:00:00Z",
  "currency": "EUR",
  "total_price": "999.00",
  "financial_status": "paid",
  "order_status_url": "https://demo-store.myshopify.com/admin/orders/4507894692",
  "email": "${EMAIL}",
  "customer": {
    "email": "${EMAIL}",
    "phone": "${PHONE}",
    "first_name": "Lorenzo",
    "last_name": "Rossi"
  },
  "line_items": [
    { "sku": "SAM-S26", "title": "Samsung Galaxy S26", "quantity": 1, "price": "999.00" }
  ]
}
JSON
)

# ── Payload spedizione (order/fulfilled) ──
fulfilled_payload=$(cat <<JSON
{
  "id": 4507894692,
  "created_at": "2026-10-13T08:00:00Z",
  "email": "${EMAIL}",
  "customer": {
    "email": "${EMAIL}",
    "phone": "${PHONE}",
    "first_name": "Lorenzo",
    "last_name": "Rossi"
  },
  "fulfillments": [
    {
      "tracking_company": "GLS",
      "tracking_number": "DEMO-S26",
      "tracking_url": "https://gls.example/track/DEMO-S26",
      "status": "in_transit"
    }
  ]
}
JSON
)

if [[ "${MODE}" == "fulfilled" ]]; then
  PAYLOAD="${fulfilled_payload}"
  TOPIC="order/fulfilled"
else
  PAYLOAD="${order_payload}"
  TOPIC="orders/create"
fi

send() {
  local url="$1" topic="$2" body="$3" extra=()
  if [[ -n "${SHOPIFY_API_SECRET:-}" ]]; then
    local hmac
    hmac=$(printf '%s' "${body}" | openssl dgst -sha256 -hmac "${SHOPIFY_API_SECRET}" -binary | base64)
    extra=(-H "X-Shopify-Hmac-Sha256: ${hmac}")
  fi
  curl -sS -X POST "${url}${TOKEN_QS}" \
    -H "Content-Type: application/json" \
    -H "X-Shopify-Topic: ${topic}" \
    -H "X-Shopify-Shop-Domain: demo-store.myshopify.com" \
    "${extra[@]}" \
    -d "${body}"
}

echo "→ POST ${WEBHOOK}${TOKEN_QS} (topic: ${TOPIC})"
send "${WEBHOOK}" "${TOPIC}" "${PAYLOAD}"
echo