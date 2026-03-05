# Telemetry

DenchClaw collects **anonymous, non-identifiable** telemetry data to help us
understand how the product is used and where to focus improvements. Participation
is optional and can be disabled at any time.

## What We Collect

| Event | When | Properties |
| --- | --- | --- |
| `cli_bootstrap_started` | `denchclaw bootstrap` begins | `version` |
| `cli_bootstrap_completed` | Bootstrap finishes | `duration_ms`, `workspace_created`, `gateway_reachable`, `web_reachable`, `version` |
| `chat_message_sent` | User sends a chat message in the web UI | `message_length`, `is_subagent` |
| `chat_stopped` | User stops an active agent run | — |
| `workspace_created` | New workspace is created | `has_seed` |
| `workspace_switched` | User switches workspaces | — |
| `workspace_deleted` | Workspace is deleted | — |
| `session_created` | New web chat session is created | — |
| `object_entry_created` | CRM object entry is created | — |
| `report_executed` | A DuckDB report is executed | — |
| `file_uploaded` | A file is uploaded to the workspace | — |
| `$pageview` | User navigates within the web app | `$current_url` (path only, no query params with user data) |

Every event includes baseline machine context: `os` (platform), `arch`, and
`node_version`. A SHA-256 hash of the machine hostname + username (truncated to
16 hex chars) is used as the anonymous distinct ID — it cannot be reversed to
identify you.

## What We Do NOT Collect

- File contents, names, or paths
- Message contents or prompts
- API keys, tokens, or credentials
- Workspace names (never sent, not even hashed)
- IP addresses (PostHog is configured to discard them)
- Environment variable values
- Error stack traces or logs
- Any personally identifiable information (PII)

## How to Opt Out

Any of these methods will disable telemetry entirely:

### CLI command

```bash
denchclaw telemetry disable
```

### Environment variable

```bash
export DENCHCLAW_TELEMETRY_DISABLED=1
```

### DO_NOT_TRACK standard

```bash
export DO_NOT_TRACK=1
```

### CI environments

Telemetry is automatically disabled when `CI=true` is set.

### Check status

```bash
denchclaw telemetry status
```

## Debug Mode

Set `DENCHCLAW_TELEMETRY_DEBUG=1` to print telemetry events to stderr instead of
sending them. Useful for inspecting exactly what would be reported.

## How It Works

- **CLI**: The `posthog-node` SDK sends events from the Node.js process. Events
  are batched and flushed asynchronously — telemetry never blocks the CLI.
- **Web app (server)**: API route handlers call `trackServer()` which uses the
  same `posthog-node` SDK on the server side.
- **Web app (client)**: The `posthog-js` SDK captures pageview events in the
  browser. No cookies are set; session data is stored in memory only.
- **PostHog project token**: The write-only project token (`phc_...`) is
  embedded in the built artifacts. It can only send events — it cannot read
  dashboards or analytics data.

## Re-enabling

```bash
denchclaw telemetry enable
```
