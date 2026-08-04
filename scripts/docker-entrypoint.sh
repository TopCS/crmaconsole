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
