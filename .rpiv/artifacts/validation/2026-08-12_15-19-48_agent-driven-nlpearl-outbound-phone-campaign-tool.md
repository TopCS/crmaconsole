---
template_version: 1
date: 2026-08-12T15:19:48+0200
author: andreab
commit: 4d993164d
branch: main
repository: crmaconsole
topic: "Validation of Agent-driven NLPearl outbound phone campaign tool"
status: ready
verdict: pass
parent: ".rpiv/artifacts/plans/2026-08-12_14-05-59_nlpearl-agent-phone-campaign.md"
tags: [validation, nlpearl, extension, agent-tool, outbound, campaign, openclaw]
last_updated: 2026-08-12T15:19:48+0200
---

## Validation Report: Agent tool → campagne outbound NLPearl dalla chat

### Implementation Status

- ✓ Phase 1: Schema — Voice Brief + External ID — Fully implemented
- ⚠️ Phase 2–6: Backend upsert/audience, route, estensione, registrazione — Not implemented (this run was executed in single-phase mode scoped to Phase 1; the remaining phases land in their own lanes and are not claimed complete)

### Automated Verification Results

- ✓ Tests (Phase 1): `pnpm --dir apps/web test workspace-schema-migrations` — 1 file, 3 tests passed
- ✓ Grep Voice Brief: `grep -rn "Voice Brief" apps/web/lib/workspace-schema-migrations.ts | wc -l` — 1 (>= 1)
- ✓ Grep CAMPAIGN_SEND_NEW_FIELDS: `grep -rn "CAMPAIGN_SEND_NEW_FIELDS" apps/web/lib/workspace-schema-migrations.ts | wc -l` — 2 (>= 2: definition + call-site :1423)
- ✓ No regressions detected: adding `export` to `CAMPAIGN_NEW_FIELDS` + defining `CAMPAIGN_SEND_NEW_FIELDS` is additive; the previously-undefined reference at `workspace-schema-migrations.ts:1423` is now resolved (fixes a pre-existing compile error). Importers import only named exports (`ONBOARDING_OBJECT_IDS`, `ensureLatestSchema`, `fetchFieldIdMap`), so no importer breaks.

### Code Review Findings

#### Matches Plan:

- `apps/web/lib/workspace-schema-migrations.ts:219` — `const CAMPAIGN_NEW_FIELDS` → `export const`; append `Voice Brief` (text, sortOrder 19) after "Nlpearl Agent Count" (sortOrder 18) — exactly per plan.
- `apps/web/lib/workspace-schema-migrations.ts:278` — `export const CAMPAIGN_SEND_NEW_FIELDS` defined with `External ID` (text, sortOrder 10) immediately after `CAMPAIGN_NEW_FIELDS`, before the "Object definitions" comment — exactly per plan.
- `apps/web/lib/workspace-schema-migrations.test.ts` — new regression suite (3 tests: Voice Brief present; External ID defined; sortOrder ordering) — exactly per plan.

#### Deviations from Plan:

None. Implementation is a faithful realization of Phase 1 of the plan.

#### Pattern Conformance:

- ✓ New `FieldDef` entries match the existing shape (`id`/`name`/`type`/`sortOrder`) of `CAMPAIGN_NEW_FIELDS` and the `seed_fld_*` ID prefix convention.
- ✓ Test structure (vitest `describe`/`it`, `find` on exported consts) matches other `apps/web/lib/*.test.ts` suites.
- ✓ Doc-comments on `CAMPAIGN_SEND_NEW_FIELDS` align with the file's JSDoc style.

#### Potential Issues:

None.

### Manual Testing Required:

1. Boot/schema migration (UAT):
   - [ ] Avviare la console e verificare che il campo `Voice Brief` appaia sotto l'oggetto `campaign` dopo la migrazione idempotente al boot
   - [ ] Verificare che `campaign_send` abbia il campo `External ID` (prerequisito perché `updateCampaignSendByExternalId` risolva le row ai webhook lead)

### Recommendations:

- Ready to commit (Phase 1) — implementation is complete and validated for this phase.
- Le Phase 2–6 restano fuori scope per questa run single-phase; procederanno nei rispettivi lane e andranno validate al termine.
