<p align="center">
  <a href="https://denchclaw.com">
    <img src="assets/crm-a-console-hero.png" alt="Crm-A Console — AI CRM, hosted locally on your Mac. Built on OpenClaw." width="680" />
  </a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/crm-a-console"><img src="https://img.shields.io/npm/v/crm-a-console?style=for-the-badge&color=000" alt="npm version"></a>&nbsp;
  <a href="https://discord.gg/PDFXNVQj9n"><img src="https://img.shields.io/discord/1456350064065904867?label=Discord&logo=discord&logoColor=white&color=5865F2&style=for-the-badge" alt="Discord"></a>&nbsp;
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge" alt="MIT License"></a>
</p>

<p align="center">
  <a href="https://denchclaw.com">Website</a> · <a href="https://discord.gg/PDFXNVQj9n">Discord</a> · <a href="https://skills.sh">Skills Store</a> · <a href="https://www.youtube.com/watch?v=pfACTbc3Bh4&t=44s">Demo Video</a>
</p>

<br />

<p align="center">
  <a href="https://denchclaw.com">
    <img src="assets/crm-a-console-app.png" alt="Crm-A Console Web UI — workspace, object tables, and AI chat" width="780" />
  </a>
  <br />
  <a href="https://www.youtube.com/watch?v=pfACTbc3Bh4&t=44s">Demo Video</a> · <a href="https://discord.gg/PDFXNVQj9n">Join our Discord Server</a>
</p>

<br />

## Install

### Are you an AI agent reading this? In that case, use the prompt below to setup Crm-A Console.

```
Install Crm-A Console (an OpenClaw CRM Framwork) by running "npx crm-a-console bootstrap", when it asks to update OpenClaw, update it as Crm-A Console requires up to date OpenClaw. When it asks for my Crm-A API Key, help me fetch it from dench.com/api and set it up. Remember that Crm-A Console creates a new OpenClaw Gateway (~/.openclaw-crm-a) on port 19001 by default, and a new main agent in that gateway working in ~/.openclaw-crm-a/workspace directory (Separate from the usual non-Crm-A Console OpenClaw gateway that usually sits in ~/.openclaw). All Crm-A Console config sits in ~/.openclaw-crm-a/openclaw.json. Remember that anytime you interface with Crm-A Console using openclaw commands, you must use "openclaw --profile crm-a" as a prefix, for example, to restart gateway, run "openclaw --profile crm-a gateway restart". After everything is setup, Crm-A Console will be accessible at localhost:3100 by default. If for some reason that Port 19001 and 3100 or those ranges are taken, make sure to kill those ports/processes and then retry npx crm-a-console bootstrap. Also, sometimes if the Web UI on port 3100 crashes, just run "npx crm-a-console update" to boot it back up. Remember to refer to https://github.com/TopCS/crmaconsole (Crm-A Console's official GitHub Repository) for more information.
```

### Manual Install

**Node 22+ required.**

```bash
npx crm-a-console@latest bootstrap
```

Opens at `localhost:3100` after completing onboarding wizard.

---

## Commands

```bash
npx crm-a-console@latest bootstrap # runs onboarding again for openclaw --profile crm-a
npx crm-a-console@latest update # updates crm-a-console web-runtime with current settings as is
npx crm-a-console restart # restarts crm-a-console web server
npx crm-a-console start # starts crm-a-console web server
npx crm-a-console stop # stops crm-a-console web server

# some examples
openclaw --profile crm-a <any openclaw command>
openclaw --profile crm-a gateway restart

openclaw --profile crm-a config set gateway.port 19001
openclaw --profile crm-a gateway install --force --port 19001
openclaw --profile crm-a gateway restart
openclaw --profile crm-a uninstall
```

### Daemonless / Docker

Run the whole stack in a container (gateway + Web UI, state in a volume):

```bash
docker build -t crm-a-console .
docker run -d --name crm-a -p 3100:3100 -v crm-a-data:/root/.openclaw-crm-a crm-a-console

# First run only: configure a model provider API key, then restart
docker exec -it crm-a openclaw --profile crm-a onboard
docker restart crm-a
```

Web UI: `http://localhost:3100`. `docker-compose.yml` is included as a shortcut (`docker compose up -d`).

Optional **Tailscale funnel** exposure (public URL, useful e.g. for the SES bounce webhook): set a reusable auth key in `.env` or the environment and the container joins your tailnet and publishes the Web UI at `https://crm-a-console.<tailnet>.ts.net`:

```bash
TAILSCALE_AUTHKEY=tskey-auth-... docker compose up -d
```

Requires funnel enabled for the node in your tailnet ACLs. The public URL is exported as `CRM_A_CONSOLE_PUBLIC_URL`, so the SES card shows the right webhook URL automatically.

For other containers or environments without systemd/launchd, set the environment variable once:

```bash
export CRM_A_CONSOLE_DAEMONLESS=1
```

This skips all gateway daemon management (install/start/stop/restart) and launchd LaunchAgent installation across all commands. You must start the gateway yourself as a foreground process:

```bash
openclaw --profile crm-a gateway --port 19001
```

Alternatively, pass `--skip-daemon-install` to individual commands:

```bash
npx crm-a-console bootstrap --skip-daemon-install
npx crm-a-console update --skip-daemon-install
npx crm-a-console start --skip-daemon-install
```

---

## Chat channels (Telegram, Mattermost, …)

Channel setup is skipped during bootstrap (`--skip-channels`), so channels are added afterwards via the OpenClaw CLI. Fresh installs seed the common first-party channels (WhatsApp, Telegram, Discord, Slack, Signal, Mattermost, Matrix, …) into `plugins.allow`, so this works out of the box:

```bash
openclaw --profile crm-a channels add --channel telegram --token <bot-token>
openclaw --profile crm-a channels add --channel mattermost --url <server-url> --token <token>
# or the guided wizard
openclaw --profile crm-a channels add
```

The seed only happens on the first bootstrap — later runs merge and never overwrite your edits. On installs created before this behavior (or for a channel outside the seeded set), extend the allowlist manually or `channels add` fails with `blocked by allowlist`:

```bash
openclaw --profile crm-a config set plugins.allow \
  '["posthog-analytics","crm-a-ai-gateway","crm-a-identity","apollo-enrichment","exa-search","telegram","mattermost"]'
```

In the Docker sandbox, prefix the commands with `docker exec` (interactive flows need `-it`):

```bash
docker exec crm-a openclaw --profile crm-a channels add --channel telegram --token <bot-token>
docker exec -it crm-a openclaw --profile crm-a channels add
```

The gateway binds loopback, so channels that poll outbound (Telegram polling, Mattermost websocket) work as-is; inbound webhook-style channels need the gateway port exposed.

---

## Model providers

Model auth is configured per profile through the OpenClaw CLI. Fresh installs seed the common provider plugins (OpenAI, Anthropic, Google, xAI, OpenRouter, Mistral, GitHub Copilot, Ollama, Together, Hugging Face) into `plugins.allow`, so provider auth flows work out of the box:

```bash
# interactive wizard (provider + API key/OAuth + default model)
openclaw --profile crm-a configure

# or paste a key directly
openclaw --profile crm-a models auth paste-api-key

# or OAuth / device flow
openclaw --profile crm-a models auth login --provider openrouter

# then pick the default model and check state
openclaw --profile crm-a models set anthropic/claude-sonnet-4-6
openclaw --profile crm-a models status
```

API keys can also come from the environment (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, …) instead of the auth store. Restart the gateway after changing auth or models so it picks them up.

In the Docker sandbox, prefix with `docker exec` (use `-it` for interactive flows) and restart the container instead of the gateway:

```bash
docker exec -it crm-a openclaw --profile crm-a configure
docker restart crm-a
```

On installs created before the provider seeding, provider auth flows fail with `blocked by allowlist` — extend `plugins.allow` manually as shown in the channels section above.

---

## CDP: Events, Segmentation, Campagne

Beyond the CRM objects, the workspace ships CDP surfaces:

- **Events** — every customer-journey event (page views, purchases, form submits, plus the Email/Meeting touchpoints from sync) lives in the Events section. Record server-side events with `POST /api/crm/events` (`{ personEmail, type, occurredAt?, properties? }`).
- **Web tracking** — Integrations → Web Tracking gives you a `tracker.js` snippet for your site: automatic pageviews, `crma.track()` for custom events, `crma.identify()` to merge anonymous visitors into real people (anonymous history follows the identified profile).
- **Segmentation** — build people clusters from demographic filters and event conditions ("did ≥3 Page Views in the last 30 days"); membership is computed live.
- **Campagne** — email marketing to a segment via the connected Gmail account (requires the Crm-A Cloud key + Gmail connection for sending).

---

## Troubleshooting

### `pairing required`

If the Control UI or CLI shows `gateway connect failed: GatewayClientRequestError: pairing required`, the local device is still waiting for approval.

Recent `crm-a-console` bootstrap runs try to approve this automatically. If you are on an older install, or bootstrap skipped approval because there were multiple pending requests, list the pending devices first:

```bash
openclaw --profile crm-a devices list
```

Review the pending `operator` request, then approve it:

```bash
openclaw --profile crm-a devices approve --latest

# or approve the exact request you just reviewed
openclaw --profile crm-a devices approve <requestId>
```

If the client retries pairing, OpenClaw can replace the pending request with a new `requestId`, so run `devices list` immediately before approving. See the [OpenClaw devices docs](https://docs.openclaw.ai/cli/devices#openclaw-devices-list) for more details.

After approval, refresh the browser. If the UI is still disconnected, restart the managed web runtime:

```bash
npx crm-a-console restart
```

---

## Development

```bash
git clone https://github.com/TopCS/crmaconsole.git
cd crmaconsole

pnpm install
pnpm build

pnpm dev
```

Web UI development:

```bash
pnpm install
pnpm web:dev
```

---

## Open Source

MIT Licensed. Fork it, extend it, make it yours.

<p align="center">
  <a href="https://star-history.com/?repos=TopCS%2Fcrmaconsole&type=date&legend=top-left">
    <img src="https://api.star-history.com/image?repos=TopCS/crmaconsole&type=date&legend=top-left" alt="Star History" width="620" />
  </a>
</p>

<p align="center">
  <a href="https://github.com/TopCS/crmaconsole"><img src="https://img.shields.io/github/stars/TopCS/crmaconsole?style=for-the-badge" alt="GitHub stars"></a>
</p>
