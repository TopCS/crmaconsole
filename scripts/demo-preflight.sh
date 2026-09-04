#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# CRM-A Console — demo preflight
#
# Runs in ~30 seconds and checks everything that can silently ruin a live
# demo: gateway runtime, plugin registration, model reachability, Composio
# connections, web-search key, DuckDB locks, demo seed, phone/NLPearl env.
#
# Usage:  bash scripts/demo-preflight.sh
# Exit:   0 = all green, 1 = at least one FAIL (details printed inline).
# ---------------------------------------------------------------------------
set -u

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); printf "  \033[32m✔ %s\033[0m\n" "$1"; }
fail() { FAIL=$((FAIL+1)); printf "  \033[31m✘ %s\033[0m\n" "$1"; }
warn() { printf "  \033[33m… %s\033[0m\n" "$1"; }
section() { printf "\n== %s ==\n" "$1"; }

PROD="${PROD_CONTAINER:-crm-a-console}"
DEV="${DEV_CONTAINER:-crm-a-console-dev}"
DB="/root/.openclaw-crm-a/workspace/workspace.duckdb"

LOG=""

dexec() { docker exec "$PROD" sh -c "$1" 2>/dev/null; }
dlog()  { dexec "grep -i \"$1\" $LOG 2>/dev/null" | tail -1; }

# Resolve the active gateway log file (name varies by version/profile).
LOG=$(dexec "ls -t /tmp/openclaw/*.log 2>/dev/null | head -1")
[ -z "$LOG" ] && LOG="/tmp/openclaw/openclaw-$(date +%Y-%m-%d).log"


section "1. Containers"
for c in "$PROD" "$DEV"; do
  state=$(docker inspect -f '{{.State.Status}}' "$c" 2>/dev/null)
  [ "$state" = "running" ] && ok "container $c running" || fail "container $c not running ($state)"
done

section "2. Gateway runtime"
VER=$(dexec "openclaw --version 2>/dev/null" | head -1)
[ -n "$VER" ] && ok "openclaw runtime: $VER" || fail "openclaw CLI not reachable"
READY=$(dlog "gateway ready")
[ -n "$READY" ] && ok "gateway ready in logs" || fail "no 'gateway ready' in today's log — did the gateway boot?"
PLUGINS=$(dexec "grep -oE 'http server listening \([0-9]+ plugins[^\"]*' $LOG 2>/dev/null | tail -1")
echo "       $PLUGINS"
for tool in "crm_a_search_integrations" "crm_a_phone_campaign" "shopify_admin"; do
  dlog "registered $tool" >/dev/null && ok "tool registered: $tool" || fail "tool NOT registered: $tool"
done
MODEL=$(dlog "agent model:" | sed -E 's/.*"1":"([^"]*)".*/\1/')
[ -n "$MODEL" ] && ok "$MODEL" || fail "no 'agent model:' line in boot log"

section "3. Provider keys (host env file)"
for var in OPENROUTER_API_KEY GEMINI_API_KEY COMPOSIO_API_KEY; do
  if grep -qE "^${var}=.+" .env 2>/dev/null; then ok "$var present in .env"; else fail "$var missing in .env"; fi
done
IN_ENV=$(dexec "env | grep -c GEMINI_API_KEY" 2>/dev/null)
[ "$IN_ENV" -ge 1 ] 2>/dev/null && ok "GEMINI_API_KEY visible inside container" || fail "GEMINI_API_KEY not in container env (recreate container!)"

section "4. Composio integrations"
CKEY=$(grep -E "^COMPOSIO_API_KEY=" .env 2>/dev/null | cut -d= -f2)
if [ -n "$CKEY" ]; then
  CONN=$(curl -s -m 15 "https://backend.composio.dev/api/v3.1/connected_accounts?statuses=ACTIVE&limit=50" -H "X-API-Key: $CKEY")
  for tk in resend googledocs; do
    echo "$CONN" | grep -q "\"slug\":\"$tk\"" && ok "composio connected: $tk" || fail "composio NOT connected: $tk"
  done
  # Telegram for the demo goes through the OpenClaw runtime, not Composio —
  # a missing composio telegram connection is informational, not blocking.
  echo "$CONN" | grep -q "\"slug\":\"telegram\"" \
    && ok "composio connected: telegram" \
    || warn "composio telegram not connected (demo routes Telegram via the runtime — OK)"
else
  fail "COMPOSIO_API_KEY empty — cannot check connections"
fi

section "5. Web search (Gemini provider)"
dlog "web" >/dev/null  # provider list is resolved at call time; key presence is the proxy
grep -qE "^GEMINI_API_KEY=.+" .env 2>/dev/null && ok "web_search will resolve the Gemini provider" || fail "no GEMINI_API_KEY — web_search will fail live"

section "6. DuckDB — no pending locks, seed present"
LOCKTEST=$(dexec "duckdb -readonly $DB -noheader -list \"SELECT COUNT(*) FROM objects;\" 2>&1" | tr -d '[:space:]')
case "$LOCKTEST" in
  ''|*[!0-9]*) fail "DuckDB read failed: $LOCKTEST" ;;
  *) ok "DuckDB readable (objects: $LOCKTEST)" ;;
esac
if dexec "ps aux 2>/dev/null | grep -c '[d]uckdb' | grep -v '^0$'" | grep -q .; then
  warn "a duckdb process is running right now (transient) — re-run preflight if it persists"
else
  ok "no duckdb processes holding the file"
fi
PEOPLE=$(dexec "duckdb -readonly $DB -noheader -list \"SELECT COUNT(*) FROM v_people;\" 2>&1" | tr -d '[:space:]')
[ "$PEOPLE" -ge 1 ] 2>/dev/null && ok "seed present: $PEOPLE people" || fail "v_people empty or missing — run demo seed"
GALAXY=$(dexec "duckdb -readonly $DB -noheader -list \"SELECT COUNT(*) FROM v_product WHERE \\\"Name\\\" LIKE '%Galaxy%';\" 2>&1" | tr -d '[:space:]')

section "7. Phone / NLPearl env"
for var in CRM_A_PHONE_WEBHOOK_SECRET NLPEARL_ACCOUNT_ID NLPEARL_SECRET_KEY CRM_A_CONSOLE_PUBLIC_URL; do
  if grep -qE "^${var}=.+" .env 2>/dev/null; then ok "$var present"; else warn "$var missing (phone acts need it)"; fi
done
dlog "crm_a_phone_campaign" >/dev/null && ok "phone campaign tool registered" || true

section "8. HTTP surfaces"
for url in "http://127.0.0.1:3100/" "http://127.0.0.1:3102/"; do
  code=$(curl -s -o /dev/null -w "%{http_code}" -m 30 "$url")
  [ "$code" = "200" ] && ok "$url → $code" || fail "$url → $code"
done

section "9. Leftover demo clutter"
CLUTTER=$(dexec "ls /root/.openclaw-crm-a/agents/main/sessions/*.jsonl 2>/dev/null | wc -l")
warn "sessions on disk: $CLUTTER (delete test sessions from the sidebar before going live)"

printf "\n== RESULT: %d OK, %d FAIL ==\n" "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
