#!/usr/bin/env bash
# =============================================================================
# nlpearl-e2e.sh — collaudo end-to-end dell'integrazione NLPearl (harness → NLPearl)
#
# Guida la Crm-A Console (che a sua volta guida NLPearl), esercitando i veri
# endpoint del harness. Sicuro di default: crea Pearl in stato PAUSED; lead e
# attivazione SOLO con flag espliciti (per non chiamare numeri reali).
#
# Prerequisiti:
#   - .env con: CRM_A_PHONE_WEBHOOK_SECRET, NLPEARL_ACCOUNT_ID, NLPEARL_SECRET_KEY,
#               CRM_A_CONSOLE_PUBLIC_URL (origine pubblica raggiungibile da NLPearl)
#   - console attiva su localhost:3100
#
# Uso:
#   bash scripts/nlpearl-e2e.sh --check            # verifica prereq (read-only)
#   bash scripts/nlpearl-e2e.sh --create-inbound NAME PHONE_ID
#   bash scripts/nlpearl-e2e.sh --create-campaign SEGMENT_ID CAMPAIGN_ID
#   bash scripts/nlpearl-e2e.sh --send-lead CAMPAIGN_ID --lead-phone +39...
#   bash scripts/nlpearl-e2e.sh --activate CAMPAIGN_ID   # SOLO con numero che controlli
#   bash scripts/nlpearl-e2e.sh --pause CAMPAIGN_ID
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONSOLE="${CRM_A_CONSOLE_URL:-http://localhost:3100}"

# ── carica .env (root) ─────────────────────────────────────────────────────
if [ -f "$ROOT/.env" ]; then
  set -a; . "$ROOT/.env"; set +a
fi

SECRET="${CRM_A_PHONE_WEBHOOK_SECRET:-}"
BASE="$CONSOLE/api"
AUTH="Authorization: Bearer $SECRET"
CT="Content-Type: application/json"

die() { echo "✗ $*" >&2; exit 1; }
info() { echo "→ $*"; }
ok()   { echo "✓ $*"; }

require_secret() { [ -n "$SECRET" ] || die "CRM_A_PHONE_WEBHOOK_SECRET mancante in .env"; }
require_nlpearl() { [ -n "${NLPEARL_ACCOUNT_ID:-}" ] && [ -n "${NLPEARL_SECRET_KEY:-}" ] || die "NLPEARL credenziali mancanti in .env"; }

# ── funzioni ────────────────────────────────────────────────────────────────
check_prereq() {
  require_secret
  info "console: $CONSOLE"
  curl -fsS -o /dev/null "$CONSOLE/tracker.js" && ok "console raggiungibile ($CONSOLE)" || die "console non raggiungibile"
  if [ -n "${CRM_A_CONSOLE_PUBLIC_URL:-}" ]; then
    info "origin pubblica: $CRM_A_CONSOLE_PUBLIC_URL"
    curl -fsS -o /dev/null "$CRM_A_CONSOLE_PUBLIC_URL/tracker.js" && ok "origin pubblica risolve" \
      || echo "⚠ origin pubblica non raggiungibile ORA — ok solo se esposta dopo"
  else
    echo "⚠ CRM_A_CONSOLE_PUBLIC_URL non impostata — i callback NLPearl non saranno collaudabili"
  fi
  require_nlpearl
  ok "NLPearl credenziali presenti"
  echo "→ la vera raggiungibilità esterna la validerà NLPearl alla chiamata reale."
}

create_inbound() { # NAME PHONE_ID
  local name="$1" phone_id="$2"
  require_secret
  info "creo Pearl inbound (paused): $name (phoneId $phone_id)"
  curl -fsS -X POST "$BASE/nlpearl/inbound" -H "$AUTH" -H "$CT" \
    -d "{\"name\":\"$name\",\"phoneId\":\"$phone_id\"}" | python3 -m json.tool
}

create_campaign() { # CAMPAIGN_ID [BRIEF]
  local campaign_id="$1" brief="${2:-}"
  require_secret
  info "creo Pearl outbound per campagna $campaign_id (paused)"
  local payload="{\"action\":\"create\",\"campaignId\":\"$campaign_id\""
  [ -n "$brief" ] && payload="$payload,\"brief\":\"$brief\""
  payload="$payload}"
  curl -fsS -X POST "$BASE/campaigns/phone" -H "$AUTH" -H "$CT" -d "$payload" | python3 -m json.tool
}

send_lead() { # CAMPAIGN_ID LEAD_PHONE
  local campaign_id="$1" lead_phone="$2"
  require_secret
  [ -n "$lead_phone" ] || die "--lead-phone richiesto (numero che controlli)"
  info "enqueue lead per campagna $campaign_id (numero $lead_phone)"
  curl -fsS -X POST "$BASE/campaigns/phone" -H "$AUTH" -H "$CT" \
    -d "{\"action\":\"send\",\"campaignId\":\"$campaign_id\"}" | python3 -m json.tool
  echo "→ NOTA: lead aggiunti = audience della campagna (preferenza phone+opt-in)."
  echo "  Per chiamare SOLO il tuo numero, il lead deve esistere nel CRM con preferenza 'phone'."
}

set_pause() { # CAMPAIGN_ID pause|resume
  local campaign_id="$1" state="$2"
  require_secret
  info "$state Pearl campagna $campaign_id"
  curl -fsS -X POST "$BASE/campaigns/phone" -H "$AUTH" -H "$CT" \
    -d "{\"action\":\"$state\",\"campaignId\":\"$campaign_id\"}" | python3 -m json.tool
}

usage() { sed -n '2,20p' "$0"; }

# ── dispatch ────────────────────────────────────────────────────────────────
case "${1:-}" in
  --check) check_prereq ;;
  --create-inbound) [ $# -eq 3 ] || die "uso: $0 --create-inbound NAME PHONE_ID"; create_inbound "$2" "$3" ;;
  --create-campaign) [ $# -ge 2 ] || die "uso: $0 --create-campaign CAMPAIGN_ID [BRIEF]"; create_campaign "$2" "${3:-}" ;;
  --send-lead)
    [ $# -ge 2 ] || die "uso: $0 --send-lead CAMPAIGN_ID --lead-phone +39..."
    lead="" ; for ((i=1;i<=$#;i++)); do [ "${!i}" = "--lead-phone" ] && lead="${!((i+1))}"; done
    send_lead "$2" "${lead:-}"
    ;;
  --activate) [ $# -eq 2 ] || die "uso: $0 --activate CAMPAIGN_ID (solo con numero che controlli)"; set_pause "$2" resume ;;
  --pause)    [ $# -eq 2 ] || die "uso: $0 --pause CAMPAIGN_ID"; set_pause "$2" pause ;;
  *) usage; exit 1 ;;
esac