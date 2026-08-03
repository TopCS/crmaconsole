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

For containers or environments without systemd/launchd, set the environment variable once:

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
cd crm-a-console

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
  <a href="https://star-history.com/?repos=TopCS%2FCrm-A Console&type=date&legend=top-left">
    <img src="https://api.star-history.com/image?repos=TopCS/crmaconsole&type=date&legend=top-left" alt="Star History" width="620" />
  </a>
</p>

<p align="center">
  <a href="https://github.com/TopCS/crmaconsole"><img src="https://img.shields.io/github/stars/TopCS/crmaconsole?style=for-the-badge" alt="GitHub stars"></a>
</p>
