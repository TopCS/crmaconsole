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

# Purge totale di un contatto tramite l'endpoint dedicato: rimuove persona,
# interazioni, ordini, invii campagna, i loro documenti (+ file .md) e qualsiasi
# relazione che lo punta — niente residui/ghost/dangling come con i singoli DELETE.
purge_contact() {
  require_secret
  local email="$1"
  info "purge completo di $email (persona + interazioni + ordini + invii + documenti)…"
  curl -fsS -X POST "$BASE/demo/purge-contact" -H "$AUTH" -H "Content-Type: application/json"     -d "$(python3 -c 'import json,sys; print(json.dumps({"email": sys.argv[1]}))' "$email")"     | python3 -m json.tool
}

remove_lorenzo() {
  require_secret
  info "cerco il contatto 'Lorenzo' del seed…"
  if ! find_lorenzo_id >/dev/null 2>&1; then
    ok "Lorenzo già assente — niente da rimuovere."
    return 0
  fi
  purge_contact "lorenzo@example.com"
  ok "Lorenzo rimosso — il primo record nascerà dal vivo in Atto 0"
}

# Pulizia workspace: ghost entry, relazioni "dangling" e documenti orfani (anche
# i file .md orfani) — evita che fonti diverse (DB vs files vs log) divergano.
purge_orphans() {
  require_secret
  info "pulizia residui di workspace (ghost entry, relazioni orfane, documenti orfani)…"
  curl -fsS -X POST "$BASE/demo/purge-contact" -H "$AUTH" -H "Content-Type: application/json"     -d '{"purgeOrphans": true}'     | python3 -m json.tool
}

# Audit di residui: restituisce i conteggi di relazioni/documenti dangling e
# ghost entry. Usato da verify() per fallire se la pulizia non è completa.
audit_residues() {
  curl -fsS -X POST "$BASE/demo/purge-contact" -H "$AUTH" -H "Content-Type: application/json"     -d '{"auditOnly": true}'
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
  ok "Lorenzo assente."

  echo "— residui di workspace (attesi tutti 0 — verificano che NON ci siano fonti/log divergenti):"
  local residue
  residue="$(audit_residues)" || { echo "✗ audit residui fallito"; return 1; }
  echo "$residue" | python3 -m json.tool
  if echo "$residue" | python3 -c '
import sys, json
j = json.load(sys.stdin)
l = j.get("leftovers", {})
if any(l.values()):
    print("✗ residui presenti: %s" % l)
    sys.exit(1)
print("✓ nessun residuo: %s" % l)
' ; then
    ok "workspace pulito: pronto per Atto 0 (primo record dal vivo)."
  else
    echo "Hint: lancia --purge-orphans e rilancia --verify."
    return 1
  fi
}

# ── dispatch ────────────────────────────────────────────────────────────────
case "${1:-}" in
  --seed) seed ;;
  --remove-lorenzo) remove_lorenzo ;;
  --purge-orphans) purge_orphans ;;
  --audit) audit_residues | python3 -m json.tool ;;
  --verify) verify ;;
  "") seed; echo; remove_lorenzo; echo; purge_orphans; echo; verify ;;
  *) echo "uso: $0 [--seed|--remove-lorenzo|--purge-orphans|--audit|--verify]" >&2; exit 1 ;;
esac
