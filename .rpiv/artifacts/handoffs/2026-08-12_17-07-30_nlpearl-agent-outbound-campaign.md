---
date: 2026-08-14T12:52:53+0200
author: andreab
commit: 673091008
branch: main
repository: crmaconsole
topic: "Agent-driven NLPearl outbound campaign tool — Feature Implementation"
tags: [feature_development, nlpearl, extension, agent-tool, outbound, campaign, openclaw]
status: complete
last_updated: 2026-08-14T12:52:53+0200
last_updated_by: andreab
type: feature_development
---

# Handoff: Agent tool → campagne outbound NLPearl dalla chat

## Task(s)
Eseguito l'intero flusso della pipeline RPIV per **l'agente della chat che pilota campagne outbound NLPearl** (tool `crm_a_phone_campaign`): design → plan → implement (6 fasi) → validate → commit.

**Stato: COMPLETO.** Tutte le 6 fasi implementate, validato (`verdict: pass`) e committato su `main`. La feature è chiusa; in questa sessione (proseguita) sono state aggiunte anche la **skill `nlpearl`**, lo **script presentatore** `DEMO-PRESENTATION-SCRIPT.md`, il forward secret docker (`env_file: .env`) e vari aggiornamenti docs/README/piano. Restano solo passi operativi per la demo (rebuild istanza + E2E live).

## Critical References
- Piano: `.rpiv/artifacts/plans/2026-08-12_14-05-59_nlpearl-agent-phone-campaign.md` (status ready)
- Design: `.rpiv/artifacts/designs/2026-08-12_11-07-06_nlpearl-agent-phone-campaign.md` (status ready)
- Contract telefono: `WEBHOOK-PHONE-CONTRACT.md` (§9 nuova sezione tool)

## Recent changes (committati su main)
- `apps/web/lib/workspace-schema-migrations.ts` — `CAMPAIGN_NEW_FIELDS` export + campo `Voice Brief` (sortOrder 19); definita `CAMPAIGN_SEND_NEW_FIELDS` con `External ID` (fix dell'undefined a :1423). Test: `workspace-schema-migrations.test.ts` (3).
- `apps/web/lib/campaign-phone.ts` — `CampaignPhoneConfig.brief`; `loadCampaignPhoneConfig` export + lettura `Voice Brief`; `upsertPhoneCampaign` (crea/aggiorna scheda); `PhoneAudienceCriteria`; `resolveAudienceForCampaign(campaignId, criteria)` (fix C3: LIMIT nel SQL path no-segment); `enqueuePhoneCampaign(campaignId, criteria?)`; `briefContent = brief ?? cfg.brief` in `createPhonePearlForCampaign`. Test: `campaign-phone.test.ts` (7).
- `apps/web/app/api/campaigns/phone/route.ts` — azione `upsert` + helper asString/asNumber/asDays/parseAudienceCriteria + threading brief/criteria (backward-compat). Test: `route.test.ts` (9).
- `extensions/crm-a-nlpearl-outbound/index.ts` — tool `crm_a_phone_campaign` (confirm gate su send/resume) + `register()` gated su `CRM_A_PHONE_WEBHOOK_SECRET`; `openclaw.plugin.json`; `package.json`; `index.mjs` (bundle generato da build).
- `src/cli/bootstrap-external.ts` — entry `crm-a-nlpearl-outbound` in `managedBundledPlugins`.
- `docker-compose.yml` + `.env.example` — propagazione `CRM_A_PHONE_WEBHOOK_SECRET` (con `export`) + doc NLPEARL_*.
- `scripts/build-crm-a-plugins.mjs` — aggiunta estensione all'array plugins (genera index.mjs).
- `WEBHOOK-PHONE-CONTRACT.md` (§9 tool) + `DEMO-RUNBOOK.md` (sezione demo chat)
- `skills/nlpearl/SKILL.md` — skill NLPearl (API v2 + tool), appare nella Skill Store
- `DEMO-PRESENTATION-SCRIPT.md` — script presentatore beat-per-beat (Atto 6 = outbound via chat come clou)
- `docker-compose.yml` (`env_file: .env`) + `README.md` + `ROME-FUTURE-WEEK-PLAN.md` §7 aggiornati

## Learnings
- **Bug nei test ereditati dal design, fixati in implement** (solo test, intento invariato): indice mock `[0][1]` (2° arg = SQL, non `[0][0]`) in `campaign-phone.test.ts`; mock-sequencing `resolveAudienceForCampaign` per il flusso SQL-LIMIT (serve `[{segment:null}]` prima della base query; la mock simula il LIMIT) ; path `payload.pearl.nodes` (non `payload.nodes`) nel test createPhonePearlForCampaign.
- **`enqueuePhoneCampaign` seriale per lead** vs `CALL_TIMEOUT_MS=60s` del tool: per la demo tenere `count` piccolo (3–5), altrimenti il tool aborts su row `campaign_send` parziali 'Queued'.
- **Baseline repo già rotta (non mia)**: `pnpm lint` 1126 errori, `tsc` root (39) e web (errori in test/) — tutti pre-esistenti; i file toccati da questa feature sono lint/tsc-clean. `pnpm test` passa (2307).
- **Env-propagation critica**: il tool legge `CRM_A_PHONE_WEBHOOK_SECRET` dall'env del gateway OpenClaw (spawnato da CLI, `web-runtime.ts:892`). Serve valorizzarla anche lì (docker-compose ora la inoltra; in locale va nell'env di chi avvia la CLI), con valori asset uguali alla web route. Gateway sidecar port: `~/.openclaw-crm-a/web-runtime/process.json`.
- **Collaterale build**: `pnpm build:crm-a-plugins` rigenera `extensions/crm-a-{identity,ai-gateway}/index.mjs` (erano disallineati dai sorgenti). L'ho RIpartito a HEAD per tenere i commit scoped; non ri-lanciare build senza ripristinarli se si vuole lo stesso diff.

## Artifacts
- `.rpiv/artifacts/designs/2026-08-12_11-07-06_nlpearl-agent-phone-campaign.md` (design ready; D1–D10; sezione Follow-up con rischio env-propagation risolto)
- `.rpiv/artifacts/plans/2026-08-12_14-05-59_nlpearl-agent-phone-campaign.md` (piano ready, 6 fasi, Plan Review triagato: 8 applied / 1 deferred)
- `.rpiv/artifacts/validation/2026-08-12_15-19-48_agent-driven-nlpearl-outbound-phone-campaign-tool.md` (Phase 1)
- `.rpiv/artifacts/validation/2026-08-12_16-31-50_agent-driven-nlpearl-outbound-phone-campaign-tool.md` (full plan, verdict pass)
- Commit finali: `cad6a38f4`(P1) `323979131`(P2-3) `17db97f34`(P4) `0c7c73c62`(P5) `5306beb4a`(P6) `f1dce6b9b`(skill) `58be36dea`(env_file) `35753085a`(readme) `5ac5e4683`(demo script) `673091008`(piano §7)

## Action Items & Next Steps
1. **Setup demo/istanza**: `pnpm build:crm-a-plugins` + `docker compose up -d --build --force-recreate`; valorizzare `CRM_A_PHONE_WEBHOOK_SECRET` (+ NLPEARL_*) in `.env` (caricato via `env_file`); impostare origin pubblico (`CRM_A_CONSOLE_PUBLIC_URL`/tunnel).
2. **E2E live**: `bash scripts/nlpearl-e2e.sh --check` → `--create-inbound` → `--create-campaign` → (solo num operatore) send/activate. Mai numeri seed/demo.
3. **Collaudo tool in chat**: verificare che `crm_a_phone_campaign` appaia in chat e che il giro upsert→create(paused)→send(confirm) funzioni live (richiede segreto nel gateway + origin pubblico per i callback).
4. **Manual UAT / demo**: seguire `DEMO-PRESENTATION-SCRIPT.md` + checklist pre-demo.
5. **Pulizia dashboard NLPearl**: rimuovere le Pearl `OMP-Test-*` di collaudo (dashboard).
6. Opt.: affrontare il debito baseline lint/tsc (pre-esistente, separato).

## Other Notes
- Struttura estensione modello: `extensions/crm-a-ai-gateway/sync-refresh-tools.ts` + `sync-trigger.ts` (AnyAgentTool + resolveWebBaseUrl); `extensions/exa-search` (package openclaw.extensions).
- La route è Bearer-gated `CRM_A_PHONE_WEBHOOK_SECRET`; supporta multi-tenant per env, valori separati.
- Sessione pendente: verifica finale diff (git log 5 commit) + eventuale `/skill:commit` non necessaria (già tutto committato).
