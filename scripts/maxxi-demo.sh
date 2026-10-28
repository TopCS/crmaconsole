#!/usr/bin/env bash
# =============================================================================
# maxxi-demo.sh — seed / reset del workspace demo MAXXI (isolato)
#
#   bash scripts/maxxi-demo.sh seed    # carica/ricostruisce i fixture sintetici
#   bash scripts/maxxi-demo.sh health  # verifica che l'API risponda (auth ok)
#
# Il dataset vive in un DuckDB separato (<stateDir>/maxxi-demo/maxxi.duckdb):
# seed e reset non toccano il workspace CRM condiviso.
#
# Prerequisiti in .env: CRM_A_SERVICE_TOKEN (o CRM_A_PHONE_WEBHOOK_SECRET),
# CRM_A_SESSION_SECRET, CRM_A_OPERATOR_PASSWORD, CRM_A_DEMO_MODE=1.
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONSOLE="${CRM_A_CONSOLE_URL:-http://localhost:3100}"

if [ -f "$ROOT/.env" ]; then
  set -a; . "$ROOT/.env"; set +a
fi

TOKEN="${CRM_A_SERVICE_TOKEN:-${CRM_A_PHONE_WEBHOOK_SECRET:-}}"

die()  { echo "ERRORE: $*" >&2; exit 1; }
info() { echo "→ $*"; }
ok()   { echo "OK: $*"; }

[ -n "$TOKEN" ] || die "serve CRM_A_SERVICE_TOKEN (o CRM_A_PHONE_WEBHOOK_SECRET) in .env"

seed() {
  info "seed demo MAXXI (idempotente)…"
  curl -fsS -X POST "$CONSOLE/api/maxxi/seed" -H "Authorization: Bearer $TOKEN" \
    | python3 -m json.tool
  ok "dataset demo caricato"
}

health() {
  info "verifica API demo…"
  curl -fsS "$CONSOLE/api/maxxi/overview" -H "Authorization: Bearer $TOKEN" \
    | python3 -c 'import sys,json; d=json.load(sys.stdin); print("banner:", d.get("banner")); print("kpi:", json.dumps(d.get("kpis"), ensure_ascii=False))'
  ok "API raggiungibile"
}

case "${1:-}" in
  seed)   seed ;;
  health) health ;;
  *) echo "uso: $0 [seed|health]" >&2; exit 1 ;;
esac
