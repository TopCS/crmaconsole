#!/usr/bin/env bash
# =============================================================================
# demo-seed.sh — preparazione dello scenario retail per la demo "Rome Future Week"
#
# Esegue il seed della Console (POST /api/demo/seed), poi rimuove il contatto
# "Lorenzo" (persona + il suo ordine seed) così il PRIMO record nasce DAL VIVO
# in Atto 0 (acquisto Shopify), e infine verifica lo stato finale.
#
# Idempotente: si può rilanciare. Il seed è upsert; la rimozione di Lorenzo è
# no-op se non esiste. Sicuro: non tocca catalogo, segmento né gli altri contatti.
#
# Prerequisiti:
#   - .env con CRM_A_PHONE_WEBHOOK_SECRET
#   - console attiva su localhost:3100 (o CRM_A_CONSOLE_URL)
#
# Uso:
#   bash scripts/demo-seed.sh --seed            # solo seed
#   bash scripts/demo-seed.sh --remove-lorenzo  # solo rimozione Lorenzo
#   bash scripts/demo-seed.sh --verify          # solo verifica
#   bash scripts/demo-seed.sh                   # reset completo (seed + remove + verify)
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

die()  { echo "✗ $*" >&2; exit 1; }
info() { echo "→ $*"; }
ok()   { echo "✓ $*"; }

require_secret() { [ -n "$SECRET" ] || die "CRM_A_PHONE_WEBHOOK_SECRET mancante in .env"; }

# ── funzioni ────────────────────────────────────────────────────────────────
seed() {
  require_secret
  info "seed demo (catalogo + persone + ordine Lorenzo + segmento)…"
  curl -fsS -X POST "$BASE/demo/seed" -H "$AUTH" \
    | python3 -m json.tool
}

# Trova l'entry_id di Lorenzo per email (lorenzo@example.com) via l'API people.
find_lorenzo_id() {
  curl -fsS "$BASE/crm/people?limit=50" \
    | python3 -c '
import sys, json
data = json.load(sys.stdin)
for p in data.get("people", []):
    if p.get("email") == "lorenzo@example.com":
        print(p["id"])
        sys.exit(0)
sys.exit(1)
'
}

# Trova gli entry_id degli ordini il cui campo "Customer" punta a Lorenzo.
find_lorenzo_order_ids() {
  local person_id="$1"
  curl -sS "$BASE/workspace/objects/order" \
    | python3 -c '
import sys, json
person = sys.argv[1]
try:
    data = json.load(sys.stdin)
except Exception:
    data = {}
for e in data.get("entries", []):
    if e.get("Customer") == person:
        print(e["entry_id"])
' "$person_id"
}

remove_lorenzo() {
  require_secret
  info "cerco il contatto 'Lorenzo' del seed…"
  local lorenzo
  lorenzo="$(find_lorenzo_id)" || { ok "Lorenzo già assente — niente da rimuovere."; return 0; }
  info "Lorenzo entry_id: $lorenzo"

  # Rimuovi PRIMA gli ordini (il campo Customer dell'ordine punta a Lorenzo).
  local order_id
  while read -r order_id; do
    [ -n "$order_id" ] || continue
    info "rimuovo ordine seed di Lorenzo ($order_id)…"
    curl -fsS -X DELETE "$BASE/workspace/objects/order/entries/$order_id" >/dev/null
    ok "ordine rimosso"
  done < <(find_lorenzo_order_ids "$lorenzo")

  info "rimuovo il contatto Lorenzo…"
  curl -fsS -X DELETE "$BASE/workspace/objects/people/entries/$lorenzo" >/dev/null
  ok "Lorenzo rimosso — il primo record nascerà dal vivo in Atto 0"
}

verify() {
  info "verifica stato demo…"

  echo "— prodotti (attesi 3: SAM-S27 Upcoming, SAM-S26 Available, SAM-S25 Discontinued):"
  curl -fsS "$BASE/workspace/objects/product" \
    | python3 -c '
import sys, json
for e in json.load(sys.stdin).get("entries", []):
    print("   %s  ·  SKU %s  ·  %s EUR  ·  %s" % (e.get("Name"), e.get("SKU"), e.get("Price"), e.get("Status")))
'

  echo "— persone (attese 3, SENZA Lorenzo):"
  curl -fsS "$BASE/workspace/objects/people" \
    | python3 -c '
import sys, json
for e in json.load(sys.stdin).get("entries", []):
    print("   %s  ·  %s  ·  canale=%s  ·  opt-in=%s" % (e.get("Full Name"), e.get("Phone Number"), e.get("Preferred Contact Channel"), e.get("Marketing Opt-in")))
'

  echo "— segmenti (atteso 1: Lancio Samsung Galaxy):"
  curl -fsS "$BASE/workspace/objects/segment" \
    | python3 -c '
import sys, json
for e in json.load(sys.stdin).get("entries", []):
    print("   %s  ·  filtro: %s" % (e.get("Name"), e.get("Filter")))
'

  if find_lorenzo_id >/dev/null 2>&1; then
    echo "✗ ATTENZIONE: Lorenzo risulta ancora presente — rilancia --remove-lorenzo."
    return 1
  fi
  ok "Lorenzo assente: pronto per Atto 0 (primo record dal vivo)."
}

# ── dispatch ────────────────────────────────────────────────────────────────
case "${1:-}" in
  --seed) seed ;;
  --remove-lorenzo) remove_lorenzo ;;
  --verify) verify ;;
  "") seed; echo; remove_lorenzo; echo; verify ;;
  *) echo "uso: $0 [--seed|--remove-lorenzo|--verify]" >&2; exit 1 ;;
esac
