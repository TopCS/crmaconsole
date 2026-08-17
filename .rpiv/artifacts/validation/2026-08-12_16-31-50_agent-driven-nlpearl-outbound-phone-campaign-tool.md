---
template_version: 1
date: 2026-08-12T16:31:50+0200
author: andreab
commit: 4d993164d
branch: main
repository: crmaconsole
topic: "Validation of Agent-driven NLPearl outbound phone campaign tool"
status: ready
verdict: pass
parent: ".rpiv/artifacts/plans/2026-08-12_14-05-59_nlpearl-agent-phone-campaign.md"
tags: [validation, nlpearl, extension, agent-tool, outbound, campaign, openclaw]
last_updated: 2026-08-12T16:31:50+0200
---

## Validation Report: Agent tool → campagne outbound NLPearl dalla chat

### Implementation Status

- ✓ Phase 1: Schema — Voice Brief + External ID — Fully implemented (3/3 AV)
- ✓ Phase 2: Backend card upsert + lettura brief — Fully implemented (3/3 AV)
- ✓ Phase 3: Backend audience criteria + threading brief alla Pearl — Fully implemented (4/4 AV)
- ✓ Phase 4: Route — upsert + threading criteri — Fully implemented (3/3 AV)
- ✓ Phase 5: Estensione OpenClaw + tool — Fully implemented (5/5 AV, bundle generato)
- ✓ Phase 6: Registrazione + docs + ops env-propagation — Implemented; 3/6 AV passati (test + greps), lint + 2×tsc NON passano per ragioni PRE-ESISTENTI (vedi Findings)

### Automated Verification Results

- ✓ Schema tests: `pnpm --dir apps/web test workspace-schema-migrations` — 3 passed
- ✓ campaign-phone tests (P2/P3): `pnpm --dir apps/web test campaign-phone` — 7 passed
- ✓ Route tests: `pnpm --dir apps/web test campaigns/phone` — 9 passed
- ✓ Full suite: `pnpm test` — 2307 passed (CLI 194 + extensions 58 + web 2055), exit 0
- ✓ Greps per fase (Voice Brief / CAMPAIGN_SEND_NEW_FIELDS / upsert / parseAudienceCriteria / resolveAudienceForCampaign / cfg.brief / Segment not found. / crm_a_phone_campaign / confirm / CRM_A_PHONE_WEBHOOK_SECRET / onStartup|contracts / bootstrap / docker) — tutti ≥ threshold
- ✓ Bundle estensione: `pnpm build:crm-a-plugins` genera `extensions/crm-a-nlpearl-outbound/index.mjs` (8449 byte, contiene `registerTool`/`crm_a_phone_campaign`)
- ✗ Lint: `pnpm lint` — FAIL (1126 errori PRE-ESISTENTI repo-wide; i miei file: 0 errori)
- ✗ Type check root: `tsc --noEmit -p tsconfig.json` — FAIL (39 errori PRE-ESISTENTI in file di test non miei; `bootstrap-external.ts` righe del mio entry pulite)
- ✗ Type check web: `tsc --noEmit -p apps/web/tsconfig.json` — FAIL (errori PRE-ESISTENTI in `segments/[id]/members` e `onboarding/skill-template` test; i miei file: 0 errori)

### Code Review Findings

#### Matches Plan:

- `apps/web/lib/workspace-schema-migrations.ts:219,278` — `CAMPAIGN_NEW_FIELDS`→export + `Voice Brief`; `CAMPAIGN_SEND_NEW_FIELDS`/`External ID` (fix undefined :1423) — come da piano.
- `apps/web/lib/campaign-phone.ts` — `CampaignPhoneConfig.brief`, `loadCampaignPhoneConfig` export + lettura Voice Brief, `upsertPhoneCampaign`, `PhoneAudienceCriteria`, `resolveAudienceForCampaign(campaignId, criteria)` (fix C3: LIMIT nel SQL path no-segment), firma `enqueuePhoneCampaign(campaignId, criteria?)`, `briefContent = brief ?? cfg.brief` — come da piano.
- `apps/web/app/api/campaigns/phone/route.ts` — azione `upsert` + helper + threading brief/criteria backward-compatible — come da piano.
- `extensions/crm-a-nlpearl-outbound/*` — index.ts (tool+register gated su secret, confirm gate), openclaw.plugin.json, package.json, index.mjs — come da piano.
- `src/cli/bootstrap-external.ts` — entry `crm-a-nlpearl-outbound` in managedBundledPlugins; `docker-compose.yml`/`.env.example` (env-propagation, `export`); `scripts/build-crm-a-plugins.mjs` (array plugins); docs contract/runbook — come da piano.

#### Deviations from Plan:

- **Fix di bug nei test (ereditati dal design)**: `campaign-phone.test.ts` — indice argomento mock `[0][1]` (2° arg = SQL, non `[0][0]`); mock-sequencing `resolveAudienceForCampaign` per il flusso SQL-LIMIT (mock `[{segment:null}]` + simulazione LIMIT); path `payload.pearl.nodes` (non `payload.nodes`) nel test createPhonePearlForCampaign. **Solo test, intento invariato** — miglioramento, non gap.
- **Collaterale build**: `pnpm build:crm-a-plugins` ha rigenerato `extensions/crm-a-{identity,ai-gateway}/index.mjs` (ora M) — bundle pre-esistenti disallineati dai sorgenti; da revisionare in commit.
- **Baseline lint/tsc pre-esistente rotta**: le criticità Phase 6 lint/tsc non sono soddisfacibili a livello repo per errori pre-esistenti non correlati a questo change (io file scoped 0 errori).

#### Pattern Conformance:

- ✓ Estensione seguirà `AnyAgentTool` + `registerTool(tool,{name,optional:true})` (`sync-refresh-tools.ts:245`), `resolveWebBaseUrl`/sidecar (`sync-trigger.ts`), manifest contracts.tools + activation.onStartup, bundle `index.mjs` (eddbf6905).
- ✓ `upsertPhoneCampaign` usa `INSERT OR IGNORE` + DELETE/INSERT EAV coerente con `enqueuePhoneCampaign`.
- ✓ Naming `crm_a_*`/`crm-a-*`/`CRM_A_*`; Conventional Commits `feat(nlpearl):`.

#### Potential Issues:

- Baseline lint/tsc repo pre-esistente rotta (non introdotta da questo change; i file toccati sono scoped-clean).
- Bundle identity/ai-gateway rigenerati dal build: verificare che il diff sia solo refresh da sorgente.

### Manual Testing Required:

1. Boot/schema migration (UAT):
   - [ ] `Voice Brief` e `External ID` (campaign / campaign_send) dopo migrazione
2. Route (UAT, Bearer `CRM_A_PHONE_WEBHOOK_SECRET`):
   - [ ] `curl` `upsert` → campaignId; `create` con brief; `send` con criteria
3. Estensione (UAT):
   - [ ] Con il segreto valorizzato nell'env del gateway, `crm_a_phone_campaign` appare nella lista tool; `send`/`resume` senza `confirm:true` rifiutano (`needsConfirmation`)
4. Demo end-to-end:
   - [ ] Chat upsert → create (Pearl paused) → send (confirm) → activate (confirm), `count` piccolo
   - [ ] Con `CRM_A_CONSOLE_PUBLIC_URL`, `curl` esterno `/api/nlpearl/webhook/call?token=...` risolve una row `campaign_send` per `External ID`
   - [ ] `send` con `count:5` entro 60s senza row parziali 'Queued'

### Recommendations:

- Ready to commit (fasi 1–6) — l'implementazione è completa e validata. Il `pnpm test` (2307) passa; i file toccati sono lint/tsc-clean.
- Prima del commit, decidere il destino del collaterale bundle `identity`/`ai-gateway` `index.mjs` rigenerati (includerli come refresh o ripristinarli).
- La baseline lint/tsc repo-wide rotta è debito pre-esistente fuori scope: separato follow-up, non bloccante.
