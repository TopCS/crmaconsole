---
date: 2026-08-19T16:59:58+0200
author: "andreab"
commit: 6d846cf50
branch: feat/relationship-graph-and-sql
repository: crmaconsole
topic: "Workspace relationship graph + parameterized SQL migration (WIP)"
tags: [graph, duckdb, sql, security, antv-g6, chat, migration]
status: complete
last_updated: 2026-08-19T16:59:58+0200
last_updated_by: "andreab"
type: feature_development
---

# Handoff: Relationship graph + DuckDB 1.5.5 + parameterized SQL migration

## Task(s)

This session combined several independent work-streams on the crm-a-console
repo (a "Fully Managed OpenClaw Framework" for a CRM — DuckDB workspace + Next.js web UI). Status:

1. **Relationship graph feature** — COMPLETE (initial feature was already merged in the 4.2.0 main; this branch carries the post-release polish).
   - Read-only property-graph projection of the workspace EAV schema (vertices = `entries` by `objects.name`, edges = `fields.type='relation'` values). Pure SQL, no extension.
   - Interactive UI with **AntV G6 v5.1.1** (icons/colors per type, hover/select states, tooltip, legend), type/neighbor filters + natural-language query.
2. **DuckDB 1.3.0 → 1.5.5 CLI + seed rebuild** — COMPLETE (`assets/seed/workspace.duckdb` rebuilt with the new format).
3. **Chat fixes** — COMPLETE: collapse "thoughts" by default with a live one-line summary; resume-stream catch-up so a reconnecting client finalizes a finished run; staleness/deadline hardening for stuck gateway runs.
4. **Workspace richtext persist bug** — COMPLETE: values with newlines (and quotes/backslashes/CR/tab) now round-trip by using DuckDB `E'...'` escaping.
5. **Parameterized SQL migration (SQL-injection hardening)** — IN PROGRESS (Phase 1): added a parameterized query API built on DuckDB `PREPARE`/`EXECUTE` and migrated the primary entry-field write paths (6 sites). ~90 call-sites remain across read/search/write files.

All work is on branch **`feat/relationship-graph-and-sql`** (13 commits over `main` = release `4.2.0`). `main` is clean/releasable — do NOT push main until the migration on the branch is merged and validated.

## Critical References

- `apps/web/lib/workspace.ts` — every duckdb access helper + the NEW parameterized API (`DuckDBParam`, `serializeDuckDBParam`, `buildParameterizedSql`, `buildParameterizedBatchSql`, and `duckdb*Params*` variants).
- `apps/web/lib/crm-graph.ts` — graph projection + `KNOWN_OBJECT_TYPES` whitelist.
- `apps/web/lib/active-runs.ts` + `apps/web/lib/agent-runner.ts` — chat stream/run lifecycle (the resume logic).

## Recent changes (file:line)

- `apps/web/lib/workspace.ts` — added parameterized helpers (after `duckdbExecOnFile`, ~line 1090+); use `PREPARE __q AS …; EXECUTE __q(…)` and unique names per batch; also removed unused `isAbsolute as isNodeAbsolute` import.
- `apps/web/app/api/workspace/objects/[name]/entries/[id]/route.ts` (PATCH) — value writes now go through `duckdbExecOnFileParams` (`UPDATE entry_fields SET value = ? …`); `escapeStringValue` removed (superseded).
- `apps/web/app/api/workspace/objects/[name]/entries/route.ts` (POST) — same migration.
- `apps/web/lib/events.ts`, `apps/web/lib/shopify.ts`, `apps/web/lib/segments.ts` — migrated write batches to `duckdbExecOnFileParamsBatchAsync` with `?` placeholders.
- `apps/web/lib/crm-graph.ts` — graph projection + `KNOWN_OBJECT_TYPES` (now includes `product`/`order`), label priority via `COALESCE(MAX(CASE …))`, `resolveFocus` token-match.
- `apps/web/lib/crm-graph-nl.ts` — heuristics extended (type keywords incl. product/order; "bought/acquistato X" → focus+depth; strip trailing depth phrases).
- `apps/web/lib/agent-runner.ts` — `beginSubscribe*`/`catchUpCompletedRun` (chat.history catch-up); collapse-thoughts in `apps/web/app/components/chain-of-thought.tsx`; G6 canvas at `apps/web/app/components/crm/graph/g6-canvas.tsx`.
- `apps/web/app/components/crm/graph/*` + `graph-view.tsx` — G6 UI, legend, dynamic type discovery, theme colours.
- `apps/web/app/api/crm/graph/route.ts`, `…/node/route.ts`, `…/query/route.ts` — read-only graph endpoints (NL query via OpenRouter when `OPENROUTER_API_KEY` set, heuristic fallback).

## Learnings

- **DuckDB 1.5.5** has NO DuckPGQ (only v1.4.4 publishes it) → the graph layer uses a SQL projection, works on any version. Allowed to use `INSTALL duckpgq … FROM community` still 404s on 1.5.5 (verified).
- **The web app shells out to `duckdb` CLI via `exec(spawn)` for every query** (`duckdb -json <db> <sql>`); there's no native Node binding in use. `@duckdb/node-api@1.5.5.0` exists (same version) and would be the proper end-state (in-process, prepared statements, no lock thrash).
- **`sqlEscape`/`sqlString`** only escape single quotes; raw newlines (and backslashes/CR/tab) **break the SQL literal** → root cause of "richtext doesn't persist". Fixed via `E'...'` escaping; the parameterized path eliminates the bug class entirely.
- **G6 v5.1.1**: `type` field is reserved for the element shape, so entity types are renamed `entityType`/`relationType`; `render()` is async and races if called twice concurrently before init → a `ResizeObserver` + single `setData/render` is the safe pattern.
- **OpenClaw (the gateway) is a separate npm package** (peer dep). We're a fork (DenchClaw → crm-a-console) but the gateway is external. `agent.subscribe` does NOT exist in OpenClaw — the gateway broadcasts `agent`/`chat` events to all connected clients and clients filter by sessionKey. A reconnecting client can miss a terminal event; the fix was `chat.history` catch-up (synthetic `chat` final).

## Artifacts

- `.rpiv/artifacts/handoffs/2026-08-19_16-59-58_workspace-graph-sql.md` — (this file).
- Assign git: the working contents of migration + graph feature live on `feat/relationship-graph-and-sql`; `git log --oneline main..feat/…` lists the 13 commits.
- No separate design/plan doc exists for this work (it was iterative); the prior `.rpiv/artifacts/designs|plans|handoffs` are for an unrelated NLP outbound phone campaign (Aug 12).

## Action Items & Next Steps (for next agent, in priority order)

1. **Validate Phase-1 on the branch locally** (needs `pnpm install`, `pnpm build`, and a DuckDB 1.5.5 CLI): run the entry-field write flows (PATCH/POST + Shopify / CDP events) to confirm the parameterized `PREPARE/EXECUTE` batches work end-to-end. If any path fails, fix before expanding.
2. **Continue migration** next targeting the remaining write-path files: `apps/web/lib/people-merge.ts`, `strength-score.ts`, `gmail-sync.ts`, `calendar-sync.ts`, `gmail-photo-sync.ts`, `gmail-body-hydrate.ts`, `email-classifier-cleanup.ts` (all still using `sqlString`/`sql`/inline escaping). Then the read/search/filter sites (~90) — `LIKE`, `LIMIT`, `ORDER BY`, identifiers.
3. After the write paths, chip the `sqlEscape` copies (17) into one central `escapeString`/`escapeIdentifier`/`escapeLikePattern` helper.
4. Consider switching to `@duckdb/node-api` for prepared statements in-process (removes shell-out + lock contention) — a candidate for the same hardening effort.
5. Re-verify the branch meets `pnpm lint`, `tsc`, and `pnpm test` before returning to `main`.

## Other Notes

- The app (web console) runs inside a Docker compose stack; the DuckDB CLI must remain >=1.5.x (the seed was rebuilt with 1.5.5). Local dev used `duckdb` v1.5.5 CLI via `~/.duckdb/cli/latest`.
- Web project root: `/home/andrea-batazzi/dev/crm-a/crmaconsole`. Repo = `TopCS/crm-a-console` (origin), upstream remote = `DenchHQ/DenchClaw`.
- I am NOT pushing to main: `release.yml` publishes on push to main. The branch is on origin (feat/…). The user wants the integration to continue on the branch and only release after validation.

*Session was very long; handoff built to allow a fresh session to pick up quickly.*