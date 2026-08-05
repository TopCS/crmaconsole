#!/usr/bin/env bash
# Container entrypoint for Crm-A Console (daemonless mode).
#
# First run stages the local setup (idempotent), then the OpenClaw gateway and
# the managed web runtime are started as plain foreground-style processes —
# there is no systemd/launchd inside the container.
set -euo pipefail

export CRM_A_CONSOLE_DAEMONLESS=1

PROFILE="crm-a"
STATE_DIR="${OPENCLAW_STATE_DIR:-$HOME/.openclaw-crm-a}"
GATEWAY_PORT="${CRM_A_CONSOLE_GATEWAY_PORT:-19001}"
WEB_PORT="${CRM_A_CONSOLE_WEB_PORT:-3100}"

# First run only: pin the profile, seed the workspace, install the web runtime.
# Checks that need model API keys will report as failing — that is expected
# until you configure a provider key:
#   docker exec -it <container> openclaw --profile crm-a onboard
#   docker restart <container>
if [ ! -f "$STATE_DIR/openclaw.json" ]; then
  node /app/crm-a-console.mjs bootstrap \
    --non-interactive \
    --skip-daemon-install \
    --skip-update \
    --no-open || true
fi

# Daemonless mode: run the gateway ourselves.
openclaw --profile "$PROFILE" gateway --port "$GATEWAY_PORT" &
gateway_pid=$!

# Optional Tailscale exposure: when TAILSCALE_AUTHKEY is set, join the tailnet
# and publish the Web UI publicly via funnel (https://<host>.<tailnet>.ts.net).
# Note: funnel must be enabled for the node in the tailnet ACLs.
if [ -n "${TAILSCALE_AUTHKEY:-}" ]; then
  TS_HOSTNAME="${TAILSCALE_HOSTNAME:-crm-a-console}"
  mkdir -p "$STATE_DIR/tailscale"
  tailscaled --tun=userspace-networking --statedir="$STATE_DIR/tailscale" &
  for _ in $(seq 1 30); do
    tailscale status >/dev/null 2>&1 && break
    sleep 1
  done
  if tailscale up --authkey="$TAILSCALE_AUTHKEY" --hostname="$TS_HOSTNAME"; then
    tailscale funnel --bg "$WEB_PORT" || true
    TS_DNS=$(tailscale status --peers=false --json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);process.stdout.write((j.Self?.DNSName||"").replace(/\.$/,""))}catch{}})')
    if [ -n "$TS_DNS" ]; then
      export CRM_A_CONSOLE_PUBLIC_URL="https://$TS_DNS"
      echo "Tailscale funnel: https://$TS_DNS"
    fi
  else
    echo "Tailscale login failed — continuing without funnel." >&2
  fi
fi

# Auto-approve device pairing requests from the local Web UI. The sandbox is
# single-user and loopback-only, so a pending operator request can only be the
# console itself asking to connect (bootstrap does the same at setup time).
# Loops because the UI may open (and request pairing) after boot.
(
  while true; do
    openclaw --profile "$PROFILE" devices approve --latest >/dev/null 2>&1 || true
    sleep 30
  done
) &

# Start (and refresh) the managed web runtime (Next.js on WEB_PORT). `update`
# replaces the runtime assets with the ones baked into this image — `start`
# would keep whatever stale copy sits in the state volume.
node /app/crm-a-console.mjs update \
  --non-interactive \
  --skip-daemon-install \
  --no-open \
  --web-port "$WEB_PORT" || true

# Stay alive while the gateway runs; exit (and stop the container) with it.
wait "$gateway_pid"
