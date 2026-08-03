---
name: strict-external-openclaw
overview: Convert this repo into an Crm-A Console-only package that uses globally installed `openclaw` as an external runtime, with strict removal of bundled OpenClaw core source and full cutover of CLI/web flows to external contracts (CLI + gateway protocol).
todos:
  - id: crm-a-console-boundary-definition
    content: Lock Crm-A Console-only module boundary and mark all OpenClaw-owned code paths for removal
    status: completed
  - id: remove-cross-imports
    content: Eliminate `apps/web` and `ui` internal imports of local OpenClaw source by replacing with Crm-A Console-local adapters over CLI/gateway contracts
    status: completed
  - id: cli-delegation-cutover
    content: Implement Crm-A Console command delegation to global `openclaw` for non-bootstrap commands
    status: completed
  - id: peer-global-packaging
    content: Update package metadata/docs to enforce peer + global OpenClaw installation model
    status: completed
  - id: delete-openclaw-core-source
    content: Remove OpenClaw core runtime source and obsolete shims/scripts from this repository
    status: completed
  - id: release-pipeline-realignment
    content: Rework build/release checks to publish Crm-A Console-only artifacts with strict external OpenClaw dependency
    status: completed
  - id: full-cutover-validation
    content: Run full test/smoke matrix and keep one-release emergency fallback
    status: completed
isProject: false
---

# Strict External OpenClaw Cutover

## Goal

- Make this repository Crm-A Console-only.
- Remove OpenClaw core runtime code from this repo.
- Depend on globally installed `openclaw` (peer/global model), not bundled source.
- Keep Crm-A Console UX: `npx crm-a-console` bootstrap + UI on `3100` over gateway `18789`.

Reference upstream runtime source of truth: [openclaw/openclaw](https://github.com/openclaw/openclaw).

## Non-Negotiable Constraints

- No vendored OpenClaw core runtime in this repo after cutover.
- `openclaw` consumed as global binary requirement (peer + global install), not shipped here.
- Crm-A Console must communicate with OpenClaw only via stable external contracts:
  - `openclaw` CLI commands
  - Gateway WebSocket protocol

## Target Architecture

```mermaid
flowchart LR
  crmAConsoleCli[crmAConsoleCli] --> bootstrap[bootstrapFlow]
  bootstrap --> openclawBin[globalOpenclawBin]
  crmAConsoleUi[crmAConsoleUi3100] --> gatewayWs[gatewayWs18789]
  gatewayWs --> openclawRuntime[openclawRuntimeExternal]
```

## Phase 1: Define Crm-A Console-Only Boundary

- Keep only Crm-A Console-owned surfaces:
  - product layer and branding
  - bootstrap/orchestration CLI
  - web UI and workspace UX
- Mark OpenClaw-owned modules for removal from this repo.
- Primary files to re-boundary:
  - [package.json](package.json)
  - [openclaw.mjs](openclaw.mjs)
  - [src/cli/run-main.ts](src/cli/run-main.ts)
  - [src/cli/bootstrap.ts](src/cli/bootstrap.ts)
  - [src/product/adapter.ts](src/product/adapter.ts)

## Phase 2: Replace Internal Core Imports With External Contracts

- Remove all `apps/web` / `ui` imports that currently reach into local OpenClaw source internals.
- Re-implement required behavior in Crm-A Console-local adapters using gateway protocol + local helpers.
- First critical edge:
  - [apps/web/lib/agent-runner.ts](apps/web/lib/agent-runner.ts)
- Also migrate `ui/src/ui/**` consumers that import `../../../../src/*` internals.

## Phase 3: CLI Delegation Model

- Make Crm-A Console CLI own only bootstrap/product UX.
- Delegate non-bootstrap command execution to global `openclaw` binary.
- Keep rollout/fallback env gates while switching default to external execution.
- Primary files:
  - [src/cli/run-main.ts](src/cli/run-main.ts)
  - [src/cli/run-main.test.ts](src/cli/run-main.test.ts)
  - [src/cli/bootstrap.ts](src/cli/bootstrap.ts)

## Phase 4: Package + Dependency Model (Peer + Global)

- Update package metadata so Crm-A Console does not bundle OpenClaw runtime code.
- Add peer requirement/documentation for global `openclaw` presence.
- Ensure bootstrap validates and remediates missing global CLI (`npm i -g openclaw`).
- Primary files:
  - [package.json](package.json)
  - [docs/reference/RELEASING.md](docs/reference/RELEASING.md)
  - install/update docs under `docs/`

## Phase 5: Remove OpenClaw Core Source From Repo

- Delete OpenClaw-owned runtime modules from this repository once delegation and adapters are complete.
- Retain only Crm-A Console package code and tests.
- Remove obsolete build/release scripts that assume monolithic runtime shipping.
- Primary files/areas:
  - `src/` (OpenClaw runtime portions)
  - scripts that package core runtime artifacts
  - compatibility shims that re-export local OpenClaw code

## Phase 6: Build/Release Pipeline Realignment

- Adjust build outputs to ship Crm-A Console only.
- Remove checks that require bundled OpenClaw dist artifacts.
- Keep web standalone packaging + bootstrap checks.
- Primary files:
  - [tsdown.config.ts](tsdown.config.ts)
  - [scripts/release-check.ts](scripts/release-check.ts)
  - [scripts/deploy.sh](scripts/deploy.sh)

## Verification Gates

- `pnpm tsgo`, lint, and formatting pass after source removals.
- Unit/e2e coverage for:
  - bootstrap diagnostics and remediation
  - command delegation to global `openclaw`
  - gateway streaming from Crm-A Console UI
- End-to-end smoke:
  - clean machine with only global `openclaw`
  - `npx crm-a-console` bootstrap succeeds
  - UI works on `3100`, gateway on `18789`, no profile/daemon collisions.

## Rollout Safety

- Keep emergency fallback env switch for one release window.
- Remove fallback after successful release telemetry and smoke matrix pass.
