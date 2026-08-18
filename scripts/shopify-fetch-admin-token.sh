#!/usr/bin/env bash
# Ottieni SHOPIFY_ADMIN_TOKEN via client-credentials grant e scrivilo in .env.
#
# Il token Admin API (shpat_…) NON si calcola: lo emette Shopify una sola volta
# con la grant client-credentials (per le app custom). Questo script fa la
# singola POST, estrae access_token e lo salva in .env — poi la Console lo
# legge a ogni avvio (set-once, use-forever). Nessun calcolo ripetuto.
#
# Prerequisiti:
#   - SHOPIFY_CLIENT_ID    (client id dell'app CRM-A Touchpoint)
#   - SHOPIFY_API_SECRET   (client secret della stessa app)
#   - SHOPIFY_STORE_DOMAIN (es. electronyca.myshopify.com)
#   - l'app deve essere GIÀ INSTALLATA sullo store (Partner Dashboard → Manage
#     app → installa): altrimenti la grant fallisce sugli scope ordini.
#   - jq (per estrarre access_token dalla risposta JSON)
#
# Uso:
#   ./scripts/shopify-fetch-admin-token.sh            # usa i valori in .env
#   ./scripts/shopify-fetch-admin-token.sh --dry-run  # grant senza scrivere .env
#
# Le variabili in .env hanno precedenza sulle flag CLI solo se non passate
# esplicitamente; le flag CLI sovrascrivono sempre.

set -euo pipefail

ENV_FILE="${ENV_FILE:-.env}"
DRY_RUN=0

# 1) Carica .env se presente (formato KEY=value, con o senza prefix "export").
if [[ -f "${ENV_FILE}" ]]; then
  set -a
  # shellcheck disable=SC1091
  source <(sed -E 's/^[[:space:]]*export[[:space:]]+//' "${ENV_FILE}")
  set +a
fi

STORE="${SHOPIFY_STORE_DOMAIN:-}"
CLIENT_ID="${SHOPIFY_CLIENT_ID:-}"
CLIENT_SECRET="${SHOPIFY_API_SECRET:-}"

# 2) Flag CLI (sovrascrivono i valori da .env).
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --store) STORE="${2:-}"; shift 2 ;;
    --client-id) CLIENT_ID="${2:-}"; shift 2 ;;
    --client-secret) CLIENT_SECRET="${2:-}"; shift 2 ;;
    *) echo "argomento sconosciuto: $1" >&2; exit 2 ;;
  esac
done

# 3) Validazione prerequisiti.
: "${STORE:?SHOPIFY_STORE_DOMAIN non valorizzata (usa --store o .env)}"
: "${CLIENT_ID:?SHOPIFY_CLIENT_ID non valorizzato (usa --client-id o .env)}"
: "${CLIENT_SECRET:?SHOPIFY_API_SECRET non valorizzato (usa --client-secret o .env)}"
command -v jq >/dev/null 2>&1 || { echo "jq non trovato nel PATH" >&2; exit 2; }

# 4) Client-credentials grant.
ENDPOINT="https://${STORE}/admin/oauth/access_token"
RESP=$(curl -sS -w $'\n__HTTP__%{http_code}' -X POST "${ENDPOINT}" \
  -H 'Content-Type: application/json' \
  -d "{\"grant_type\":\"client_credentials\",\"client_id\":\"${CLIENT_ID}\",\"client_secret\":\"${CLIENT_SECRET}\"}")

BODY="${RESP%$'\n__HTTP__'*}"
STATUS="${RESP##*__HTTP__}"

if [[ "${STATUS}" != "200" ]]; then
  echo "errore: client-credentials grant fallita (HTTP ${STATUS})." >&2
  echo "  risposta: ${BODY}" >&2
  echo "  verifica che l'app CRM-A Touchpoint sia installata su ${STORE}." >&2
  exit 1
fi

TOKEN=$(jq -r '.access_token // empty' <<<"${BODY}")
SCOPE=$(jq -r '.scope // empty' <<<"${BODY}")

if [[ -z "${TOKEN}" || "${TOKEN}" == "null" ]]; then
  echo "errore: nessun access_token nella risposta: ${BODY}" >&2
  exit 1
fi

echo "→ access_token: ${TOKEN:0:8}… (scope: ${SCOPE:-n/d})"

# 5) Scrivi in .env (idempotente: sostituisci la riga esistente, o accodala).
if [[ "${DRY_RUN}" == "1" ]]; then
  echo "[dry-run] ${ENV_FILE} NON modificato."
  exit 0
fi

if grep -qE '^[[:space:]]*(export[[:space:]]+)?SHOPIFY_ADMIN_TOKEN=' "${ENV_FILE}"; then
  sed -i -E 's|^([[:space:]]*)(export[[:space:]]+)?SHOPIFY_ADMIN_TOKEN=.*|\1\2SHOPIFY_ADMIN_TOKEN='"${TOKEN}"'|' "${ENV_FILE}"
else
  printf 'SHOPIFY_ADMIN_TOKEN=%s\n' "${TOKEN}" >> "${ENV_FILE}"
fi

echo "✓ SHOPIFY_ADMIN_TOKEN aggiornato in ${ENV_FILE}"
