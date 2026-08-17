---
date: 2026-08-12
author: andreab
commit: 4d993164d
branch: main
repository: crmaconsole
topic: agent-driven NLPearl outbound phone campaign tool
tags: [design, nlpearl, extension, agent-tool, outbound, campaign, openclaw]
status: ready
parent: none
last_updated: 2026-08-12T11:07:06+0200
last_updated_by: andreab
last_updated_note: "Follow-up advisory: env-propagation segreto (critico), timeout enqueue (medio), baseline root tsc (minore)"
---

# Design: Agent tool → campagne outbound NLPearl dalla chat

## Summary

Una nuova estensione OpenClaw registra il tool `crm_a_phone_campaign`, che permette all'agente della chat di pilotare campagne outbound NLPearl: creare/aggiornare la scheda campagna (prodotto, comparazioni, config telefonica), creare il Pearl Voice su NLPearl (paused), definire l'audience ("chi chiamare") e inviare lead / attivare — sempre sotto conferma esplicita. Il tool chiama la route esistente `POST /api/campaigns/phone`, estesa con un'azione `upsert` e con il threading di brief + criteri audience. Riusa l'orchestrazione già testata; nessun nuovo backend parallelo né nuovo store di segreti.

## Requirements

- L'operatore struttura una campagna outbound **chattando con l'agente** nella Console.
- L'agente crea la scheda campagna (prodotto, comparazioni, config telefono, voice) per il percorso telefonico.
- L'agente definisce **chi chiamare** (criteri audience) sopra una base di compliance obbligatoria (marketing opt-in + prefschia channel = telefono).
- L'agente crea via API NLPearl la **campagna (Pearl Voice)**, i **lead** e registra l'**attività** (esiti via webhook).
- La voce del Pearl riflette il **brief** (prodotto/comparazioni) della scheda — non uno script generico.
- `send` (lead enqueue) e `activate` richiedono **conferma esplicita** dell'operatore, imposta dal tool (`confirm: true` obbligatorio).
- Nessun numero seed/demo viene usato; nessuna chiamata accidentale in demo.

## Current State Analysis

Esiste già il plumbing end-to-end ma non è agganciato all'agente:

- **Client NLPearl tipizzato**: `apps/web/lib/nlpearl.ts` — `createVoicePearl` (POST /Pearl/Voice, ID in plain-text), `addLead` (POST /Outbound/{pearl}/Lead), `setPearlActive`, `listPhoneNumbers`, `listVoices`, `resolveVoiceId`, `buildNlpearlCallbackUrls`.
- **Orchestrazione**: `apps/web/lib/campaign-phone.ts` — `createPhonePearlForCampaign`, `enqueuePhoneCampaign`, `resolveAudienceForCampaign`, `updateCampaignSendByExternalId`, `setCampaignPearlPaused`.
- **Route**: `apps/web/app/api/campaigns/phone/route.ts` — azioni `create`/`send`/`pause`/`resume`, Bearer gate via `isPhoneWebhookAuthorized`.
- **Nessun tool agente** la chiama oggi (scope: estensione).

### Key Discoveries

- `createPhonePearlForCampaign(campaignId, origin, brief?)` accetta `brief` (`campaign-phone.ts:86`) ma la route lo chiama senza (`route.ts:70`) → il Pearl usa uno script generico.
- Nessun campo/relation sulla scheda per il brief: il più vicino è `product.Marketing Message` + `marketing-brief.ts`, non cablati sul flusso phone.
- **Bug pre-esistente**: `CAMPAIGN_SEND_NEW_FIELDS` referenziato (`workspace-schema-migrations.ts:1423`) ma mai definito → il campo `External ID` su `campaign_send` manca → `updateCampaignSendByExternalId` (campaign-phone.ts:264) fa silent no-op → tracking esiti lead rotto.
- `resolveAudienceForCampaign()` non riceve parametri e ignora `campaignId`: seleziona globalmente (pref=phone + opt-in, LIMIT 500) — non è per-campagna.
- L'agente oggi non ha alcun tool che scrive oggetti CRM: muta solo via `duckdb` CLI nella skill `crm` (`skills/crm/SKILL.md:127`).
- Pattern di estensione: tool `AnyAgentTool` (exa-search/index.ts:237-339), tool→route app con Bearer (`crm-a-ai-gateway/sync-refresh-tools.ts:142-242`, `sync-trigger.ts:131-262`), manifest con `contracts.tools` + `registerTool` a startup, allowlist bootstrap (`bootstrap-external.ts:3427-3466`), bundle `index.mjs` (`eddbf6905`).
- Doc-alongside-feature: `WEBHOOK-PHONE-CONTRACT.md`, `DEMO-RUNBOOK.md`, `ROME-FUTURE-WEEK-PLAN.md` committati con la feature (`e0d6324b1`).

## Scope

### Building
- Estensione OpenClaw `crm-a-nlpearl-outbound` con tool `crm_a_phone_campaign` (azioni upsert/create/send/pause/resume, `confirm:true` obbligatorio su send/activate).
- Backend: azione `upsert` su `/api/campaigns/phone` (crea/aggiorna scheda + config phone), threading `brief` (Voice Brief) a `createPhonePearlForCampaign`, criteri audience a `enqueuePhoneCampaign`.
- Schema: campo `Voice Brief` su campaign; definizione `CAMPAIGN_SEND_NEW_FIELDS` (External ID).
- Registrazione estensione (bootstrap-external + integrations mirror), bundle `index.mjs`, docs contract/runbook.

### Not Building
- CRUD completo oggetti campagne (solo upsert minimale del percorso phone).
- Upload di lista libera/arbitraria di numeri (bypassa opt-in).
- Modifiche UI alle schede (la scheda resta editabile da CRM UI / skill crm).
- **Mirror del plugin nelle Integrations UI** (rimosso: `getIntegrationsState` filtra solo gateway/identity — integrazions.ts:1090 → sarebbe codice morto; la registrazione via bootstrap è sufficiente e il tool si auto-disabilita senza segreto).
- Nuovi store di segreti (si riusa `CRM_A_PHONE_WEBHOOK_SECRET`).
- Invio outbound Telegram/email: resta il percorso esclusivamente NLPearl-phone.

## Decisions

### D1 — Pattern estensione (directional follow)
Approach: nuova estensione OpenClaw che registra un tool `AnyAgentTool`. 
Explored: exa-search index.ts:237-339 (tool factory) + sync-refresh-tools.ts:142-242 / sync-trigger.ts:131-262 (tool che chiama route app con Bearer) + manifest con contracts.tools e registerTool a startup.
Decision: seguire il pattern estensioni esistente. Evidenza: precedenti Apollo/Exa/gateway/identity; fix `e321f50da`/`37e00d652` (contrat erti + registerTool a startup required); `eddbf6905` (index.mjs).

### D2 — Riusa POST /api/campaigns/phone (directional follow)
Decision: il tool chiama la route esistente (estesa), niente backend parallelo. Evidenza: route.ts:34, orchestrazione e test già verdi.

### D3 — Segreto = CRM_A_PHONE_WEBHOOK_SECRET (directional follow)
Decision: il tool si autentica con lo stesso segreto che la route valida (phone-webhook.ts:38), single source of truth (2cf178401). Evidenza: estensione e web app condividono l'env.

### D4 — Naming crm_a_* / crm-a-* / CRM_A_* (directional follow)
Decision: estensione `crm-a-nlpearl-outbound`, tool `crm_a_phone_campaign`, env `CRM_A_PHONE_*`. Precedente rename 045998854.

### D5 — Scope: flusso completo scoped
Decision: un solo tool crea la scheda + Pearl paused + audience + (confermato) send/activate. Non si costruisce CRUD completo.

### D6 — Brief = campo `Voice Brief` su campaign
Ambiguity → Explored: (A) campo testo su campaign (compilato dall'agente da chat), (B) relation campaign→product che risolve Marketing Message, (C) brief solo nel body.
Decision: (A) campo `Voice Brief` (text) in CAMPAIGN_NEW_FIELDS, letto da loadCampaignPhoneConfig, passato a createPhonePearlForCampaign(brief) dalla route `create`. Evidenza: campaign-phone.ts:86, :70.

### D7 — Audience = criteri agent su base compliant
Explored: (A) deterministico globale, (B) criteri opzionali (segmento/count) sopra compliance, (C) lista libera.
Decision: (B). `resolveAudienceForCampaign(campaignId, criteria)` e `enqueuePhoneCampaign(campaignId, criteria)`; il filtro di compliance (opt-in + pref=telefono) resta SEMPRE vincolante; si fixa il bug per cui oggi ignora campaignId.

### D8 — Includi fix External ID
Explored: includere vs rimandare.
Decision: includere. Definire `CAMPAIGN_SEND_NEW_FIELDS` con `External ID` (workspace-schema-migrations.ts:1423) + test di regressione. Senza questo il tracking esiti resta rotto.

### D9 — `confirm: true` obbligatorio su send/activate
Explored: enforcement nel tool vs convenzione.
Decision: enforcement. Lo schema del tool richiede `confirm: true` per `send`/`resume` (activate); senza, il tool rifiuta. L'agente è istruito a chiedere conferma all'operatore prima. Nota: la route non ha un'azione `activate` — `resume` è l'equivalente (avvio chiamate).

### D10 — Nessun mirror Integrations UI
Decision: la registrazione dell'estensione avviene SOLO via `bootstrap-external.ts` (single array `syncBundledPlugins` → copia + allowlist + loadPaths). Non si aggiunge spec a `apps/web/lib/integrations.ts` perché `getIntegrationsState` filtra managedPlugins a `crm-a-ai-gateway`+`crm-a-identity` (integrations.ts:1090) e `ensureDefaultManagedPluginsInstalled` itera solo `REQUIRED_MANAGED_PLUGIN_IDS` → la spec sarebbe codice morto. Coerente con scope "Not Building: modifiche UI".

## Architecture

### apps/web/lib/workspace-schema-migrations.ts — MODIFY
1) `const CAMPAIGN_NEW_FIELDS` → `export const CAMPAIGN_NEW_FIELDS`; append `Voice Brief` dopo "Nlpearl Agent Count". 2) Subito dopo la chiusura di `CAMPAIGN_NEW_FIELDS`, definire `CAMPAIGN_SEND_NEW_FIELDS` (fix del riferimento orfano a :1423).

```ts
// 1) In CAMPAIGN_NEW_FIELDS, dopo l'ultimo entry "Nlpearl Agent Count" (sortOrder 18):
export const CAMPAIGN_NEW_FIELDS: FieldDef[] = [
  // ... entries esistenti (Nlpearl Pearl ID ... Nlpearl Agent Count) ...
  {
    id: "seed_fld_campaign_agents_00000000",
    name: "Nlpearl Agent Count",
    type: "number",
    sortOrder: 18,
  },
  {
    id: "seed_fld_campaign_voice_brief0",
    name: "Voice Brief",
    type: "text",
    sortOrder: 19,
  },
];

// 2) Subito dopo la chiusura di CAMPAIGN_NEW_FIELDS (prima del commento Object definitions):
/**
 * Phone-delivery tracking fields for `campaign_send`. Additive to the seed
 * campaign_send schema. `External ID` carries the NLPearl lead id (equal to the
 * campaign_send row UUID) so lead/call webhooks can resolve the row and update
 * Status (see campaign-phone.ts updateCampaignSendByExternalId).
 */
export const CAMPAIGN_SEND_NEW_FIELDS: FieldDef[] = [
  {
    id: "seed_fld_campaign_send_extid0",
    name: "External ID",
    type: "text",
    sortOrder: 10,
  },
];
```

### apps/web/lib/workspace-schema-migrations.test.ts — NEW
Test: `Voice Brief` in CAMPAIGN_NEW_FIELDS; `External ID` in CAMPAIGN_SEND_NEW_FIELDS; ordinamento sortOrder.

```ts
import { describe, expect, it } from "vitest";
import {
  CAMPAIGN_NEW_FIELDS,
  CAMPAIGN_SEND_NEW_FIELDS,
} from "./workspace-schema-migrations";

describe("workspace-schema-migrations field additions", () => {
  it("adds a Voice Brief field to the campaign object for the NLPearl voice script", () => {
    const brief = CAMPAIGN_NEW_FIELDS.find((f) => f.name === "Voice Brief");
    expect(brief).toBeDefined();
    expect(brief?.type).toBe("text");
  });

  it("defines the campaign_send External ID field (previously referenced but missing)", () => {
    expect(Array.isArray(CAMPAIGN_SEND_NEW_FIELDS)).toBe(true);
    const ext = CAMPAIGN_SEND_NEW_FIELDS.find((f) => f.name === "External ID");
    expect(ext).toBeDefined();
    expect(ext?.type).toBe("text");
  });

  it("keeps Voice Brief sortOrder after the existing calling config fields", () => {
    const agents = CAMPAIGN_NEW_FIELDS.find((f) => f.name === "Nlpearl Agent Count");
    const brief = CAMPAIGN_NEW_FIELDS.find((f) => f.name === "Voice Brief");
    expect(brief?.sortOrder).toBeGreaterThan(agents?.sortOrder ?? 0);
  });
});
```

### apps/web/lib/campaign-phone.ts — MODIFY (Slice 2: upsert + brief read; Slice 3: audience)
Le modifiche di Slice 2:

```ts
// --- CampaignPhoneConfig: aggiunto campo brief ---
export type CampaignPhoneConfig = {
  pearlId: string | null;
  phoneId: string;
  windowStart: string | null;
  windowEnd: string | null;
  timezone: string | null;
  days: number[] | null;
  maxAttempts: number;
  retryRate: number;
  agentCount: number;
  brief: string | null;
};

// --- loadCampaignPhoneConfig: export + lettura Voice Brief ---
// In cima al SELECT, accanto alle altre colonne guardate, aggiungere:
export async function loadCampaignPhoneConfig(campaignId: string): Promise<CampaignPhoneConfig | null> {
  const fieldMaps = await loadCrmFieldMaps();
  const map = fieldMaps.campaign;
  const sql = `
    SELECT
      e.id,
      ${map["Nlpearl Pearl ID"] ? `MAX(CASE WHEN ef.field_id = '${map["Nlpearl Pearl ID"]}' THEN ef.value END) AS pearlId` : "NULL AS pearlId"},
      ${map["Nlpearl Phone ID"] ? `MAX(CASE WHEN ef.field_id = '${map["Nlpearl Phone ID"]}' THEN ef.value END) AS phoneId` : "NULL AS phoneId"},
      ${map["Calling Window Start"] ? `MAX(CASE WHEN ef.field_id = '${map["Calling Window Start"]}' THEN ef.value END) AS windowStart` : "NULL AS windowStart"},
      ${map["Calling Window End"] ? `MAX(CASE WHEN ef.field_id = '${map["Calling Window End"]}' THEN ef.value END) AS windowEnd` : "NULL AS windowEnd"},
      ${map["Calling Timezone"] ? `MAX(CASE WHEN ef.field_id = '${map["Calling Timezone"]}' THEN ef.value END) AS timezone` : "NULL AS timezone"},
      ${map["Calling Days"] ? `MAX(CASE WHEN ef.field_id = '${map["Calling Days"]}' THEN ef.value END) AS daysRaw` : "NULL AS daysRaw"},
      ${map["Max Attempts"] ? `MAX(CASE WHEN ef.field_id = '${map["Max Attempts"]}' THEN ef.value END) AS maxAttempts` : "NULL AS maxAttempts"},
      ${map["Nlpearl Retry Rate"] ? `MAX(CASE WHEN ef.field_id = '${map["Nlpearl Retry Rate"]}' THEN ef.value END) AS retryRate` : "NULL AS retryRate"},
      ${map["Nlpearl Agent Count"] ? `MAX(CASE WHEN ef.field_id = '${map["Nlpearl Agent Count"]}' THEN ef.value END) AS agentCount` : "NULL AS agentCount"},
      ${map["Voice Brief"] ? `MAX(CASE WHEN ef.field_id = '${map["Voice Brief"]}' THEN ef.value END) AS brief` : "NULL AS brief"}
    FROM entries e
    LEFT JOIN entry_fields ef ON ef.entry_id = e.id
    WHERE e.object_id = '${ONBOARDING_OBJECT_IDS.campaign}' AND e.id = ${sqlString(campaignId)}
    GROUP BY e.id LIMIT 1;`;
  const rows = await duckdbQueryAsync<Record<string, string | null>>(sql);
  const r = rows[0];
  if (!r) { return null; }
  let days: number[] | null = null;
  if (r.daysRaw) {
    try {
      const parsed = JSON.parse(r.daysRaw);
      if (Array.isArray(parsed)) { days = parsed.filter((v) => typeof v === "number"); }
    } catch {
      days = r.daysRaw.split(",").map(Number).filter((v) => !Number.isNaN(v));
    }
  }
  return {
    pearlId: r.pearlId ?? null,
    phoneId: r.phoneId ?? "",
    windowStart: r.windowStart ?? null,
    windowEnd: r.windowEnd ?? null,
    timezone: r.timezone ?? null,
    days,
    maxAttempts: r.maxAttempts ? Number(r.maxAttempts) : 3,
    retryRate: r.retryRate ? Number(r.retryRate) : 1,
    agentCount: r.agentCount ? Number(r.agentCount) : 5,
    brief: r.brief ?? null,
  };
}

// --- Nuova upsert (crea/aggiorna scheda + config phone) ---
export type PhoneCampaignUpsertInput = {
  campaignId?: string;
  name?: string;
  phoneId?: string;
  windowStart?: string;
  windowEnd?: string;
  timezone?: string;
  days?: number[];
  maxAttempts?: number;
  retryRate?: number;
  agentCount?: number;
  brief?: string;
};

export async function upsertPhoneCampaign(input: PhoneCampaignUpsertInput): Promise<string> {
  const dbPath = await duckdbPathAsync();
  if (!dbPath) { throw new Error("DuckDB not found."); }
  const fieldMaps = await loadCrmFieldMaps();
  const campaignId = input.campaignId?.trim() ? input.campaignId.trim() : randomUUID();
  const now = new Date().toISOString();
  const statements: string[] = [
    `INSERT OR IGNORE INTO entries (id, object_id, created_at, updated_at) VALUES (${sqlString(campaignId)}, ${sqlString(ONBOARDING_OBJECT_IDS.campaign)}, ${sqlString(now)}, ${sqlString(now)});`,
  ];
  const writeField = (name: string, value: string | number | null | undefined) => {
    const fieldId = fieldMaps.campaign[name];
    if (!fieldId || value === undefined || value === null || value === "") { return; }
    statements.push(
      `DELETE FROM entry_fields WHERE entry_id = ${sqlString(campaignId)} AND field_id = ${sqlString(fieldId)};`,
      `INSERT INTO entry_fields (entry_id, field_id, value) VALUES (${sqlString(campaignId)}, ${sqlString(fieldId)}, ${sqlString(String(value))});`,
    );
  };
  writeField("Name", input.name);
  writeField("Nlpearl Phone ID", input.phoneId);
  writeField("Calling Window Start", input.windowStart);
  writeField("Calling Window End", input.windowEnd);
  writeField("Calling Timezone", input.timezone);
  writeField("Calling Days", input.days ? JSON.stringify(input.days) : undefined);
  writeField("Max Attempts", input.maxAttempts);
  writeField("Nlpearl Retry Rate", input.retryRate);
  writeField("Nlpearl Agent Count", input.agentCount);
  writeField("Voice Brief", input.brief);
  statements.push(`UPDATE entries SET updated_at = ${sqlString(now)} WHERE id = ${sqlString(campaignId)};`);
  await duckdbExecOnFileAsync(dbPath, statements.join("\n"));
  return campaignId;
}

// --- Slice 3: audience criteria + threading brief alla Pearl ---

// Import aggiunto in cima al file:
//   import { listSegmentMembers, type SegmentDefinition } from "./segments";

export type PhoneAudienceCriteria = {
  segmentId?: string;
  count?: number;
};

async function resolveCampaignSegmentId(campaignId: string): Promise<string | null> {
  const fieldMaps = await loadCrmFieldMaps();
  const segFld = fieldMaps.campaign["Segment"];
  if (!segFld) { return null; }
  const rows = await duckdbQueryAsync<{ segment: string | null }>(
    `SELECT MAX(CASE WHEN ef.field_id = '${segFld}' THEN ef.value END) AS segment
     FROM entries e LEFT JOIN entry_fields ef ON ef.entry_id = e.id
     WHERE e.object_id = '${ONBOARDING_OBJECT_IDS.campaign}' AND e.id = ${sqlString(campaignId)}
     GROUP BY e.id LIMIT 1;`,
  );
  return rows[0]?.segment?.trim() || null;
}

async function resolveSegmentMemberIds(segmentId: string): Promise<Set<string>> {
  const rows = await duckdbQueryAsync<{ filter: string | null }>(
    `SELECT v."Filter" AS filter FROM v_segment v WHERE v.entry_id = ${sqlString(segmentId)} LIMIT 1;`,
  );
  if (rows.length === 0) { throw new Error("Segment not found."); }
  let def: SegmentDefinition = {};
  if (rows[0]?.filter) { def = JSON.parse(rows[0].filter) as SegmentDefinition; }
  const { members } = await listSegmentMembers(def, { limit: 2000 });
  return new Set(members.map((m) => m.entry_id));
}

function cap(criteria?: PhoneAudienceCriteria): number {
  return criteria?.count && criteria.count > 0 ? Math.floor(criteria.count) : 500;
}

/**
 * Phone-compliant audience (opt-in + preferred channel = phone), optionally
 * scoped to a segment (explicit criteria.segmentId, else the campaign Segment)
 * and capped by criteria.count. Fixes the prior bug where the audience ignored
 * campaignId.
 */
export async function resolveAudienceForCampaign(
  campaignId: string,
  criteria?: PhoneAudienceCriteria,
): Promise<Array<{ entry_id: string; name: string | null; email: string | null; phone: string | null }>> {
  const fieldMaps = await loadCrmFieldMaps();
  const phoneFld = fieldMaps.people["Phone Number"];
  const nameFld = fieldMaps.people["Full Name"];
  const emailFld = fieldMaps.people["Email Address"];
  const optinFld = fieldMaps.people["Marketing Opt-in"];
  const prefFld = fieldMaps.people["Preferred Contact Channel"];
  if (!phoneFld) { return []; }

  const baseSql = `
    SELECT e.id AS entry_id,
      ${nameFld ? `MAX(CASE WHEN ef.field_id = '${nameFld}' THEN ef.value END)` : "NULL"} AS name,
      ${emailFld ? `MAX(CASE WHEN ef.field_id = '${emailFld}' THEN ef.value END)` : "NULL"} AS email,
      ${phoneFld ? `MAX(CASE WHEN ef.field_id = '${phoneFld}' THEN ef.value END)` : "NULL"} AS phone
    FROM entries e
    LEFT JOIN entry_fields ef ON ef.entry_id = e.id
    WHERE e.object_id = '${ONBOARDING_OBJECT_IDS.people}'
      ${optinFld ? `AND EXISTS (SELECT 1 FROM entry_fields o WHERE o.entry_id = e.id AND o.field_id = '${optinFld}' AND o.value = 'true')` : ""}
      ${prefFld ? `AND EXISTS (SELECT 1 FROM entry_fields p WHERE p.entry_id = e.id AND p.field_id = '${prefFld}' AND p.value = 'phone')` : ""}
    GROUP BY e.id
    HAVING MAX(CASE WHEN ef.field_id = '${phoneFld}' THEN ef.value END) IS NOT NULL
       AND MAX(CASE WHEN ef.field_id = '${phoneFld}' THEN ef.value END) != '';`;
  const rows = await duckdbQueryAsync<{ entry_id: string; name: string | null; email: string | null; phone: string | null }>(baseSql);

  const segmentId = criteria?.segmentId?.trim() || (await resolveCampaignSegmentId(campaignId)) || undefined;
  if (segmentId) {
    const members = await resolveSegmentMemberIds(segmentId);
    const scoped = rows.filter((r) => members.has(r.entry_id));
    return scoped.slice(0, cap(criteria));
  }
  return rows.slice(0, cap(criteria));
}

// enqueuePhoneCampaign: firma aggiornata + pass-through criteri:
//   export async function enqueuePhoneCampaign(
//     campaignId: string,
//     criteria?: PhoneAudienceCriteria,
//   ): Promise<PhoneCampaignEnqueueResult> {
//     ...
//     const audience = await resolveAudienceForCampaign(campaignId, criteria);
//     ...
//  }

// createPhonePearlForCampaign: script voce default dal Voice Brief della scheda:
//   const briefContent = brief ?? cfg.brief ?? undefined;
//   ...
//   instructions: briefContent ? `Contenuto offerta da comunicare:\n${briefContent.trim().slice(0, 8000)}` : undefined,
```

### apps/web/lib/campaign-phone.test.ts — MODIFY (Slice 2: upsert/brief; Slice 3: audience)
Merged (Slice 2 + Slice 3):

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const execMock = vi.fn().mockResolvedValue(undefined);
const pathMock = vi.fn().mockResolvedValue("/tmp/workspace.duckdb");
const queryMock = vi.fn().mockResolvedValue([]);
const listMembersMock = vi.fn();
const createVoicePearlMock = vi.fn().mockResolvedValue("pearl-1");
const resolveVoiceIdMock = vi.fn().mockResolvedValue("voice-1");

vi.mock("./workspace", () => ({
  duckdbExecOnFileAsync: (...a: unknown[]) => execMock(...a),
  duckdbPathAsync: (...a: unknown[]) => pathMock(...a),
  duckdbQueryAsync: (...a: unknown[]) => queryMock(...a),
}));

const fieldMapsMock = vi.fn();
vi.mock("./crm-queries", () => ({
  loadCrmFieldMaps: () => fieldMapsMock(),
  sqlString: (v: string) => `'${String(v).replace(/'/g, "''")}'`,
}));

vi.mock("./segments", () => ({
  listSegmentMembers: (...a: unknown[]) => listMembersMock(...a),
  buildSegmentWhereSql: vi.fn(),
}));

vi.mock("./nlpearl", () => ({
  isNlpearlConfigured: () => true,
  createVoicePearl: (...a: unknown[]) => createVoicePearlMock(...a),
  resolveVoiceId: (...a: unknown[]) => resolveVoiceIdMock(...a),
  buildNlpearlCallbackUrls: () => ({
    callWebhookUrl: "https://x/api/nlpearl/webhook/call",
    leadWebhookUrl: "https://x/api/nlpearl/webhook/lead",
  }),
}));

vi.mock("./phone-webhook", () => ({
  readPhoneWebhookSecret: () => "secret",
}));

import {
  createPhonePearlForCampaign,
  loadCampaignPhoneConfig,
  resolveAudienceForCampaign,
  upsertPhoneCampaign,
} from "./campaign-phone";

function campaignMap(overrides: Record<string, string> = {}) {
  return {
    campaign: {
      Name: "fld_campaign_name",
      "Nlpearl Pearl ID": "fld_pearl_id",
      "Nlpearl Phone ID": "fld_phone_id",
      "Calling Window Start": "fld_win_start",
      "Calling Window End": "fld_win_end",
      "Calling Timezone": "fld_tz",
      "Calling Days": "fld_days",
      "Max Attempts": "fld_attempts",
      "Nlpearl Retry Rate": "fld_retry",
      "Nlpearl Agent Count": "fld_agents",
      "Voice Brief": "fld_voice_brief",
      "Segment": "fld_segment",
      ...overrides,
    },
    campaign_send: {},
    people: {
      "Phone Number": "fld_phone",
      "Full Name": "fld_name",
      "Email Address": "fld_email",
      "Marketing Opt-in": "fld_optin",
      "Preferred Contact Channel": "fld_pref",
    },
  };
}

describe("upsertPhoneCampaign", () => {
  beforeEach(() => {
    execMock.mockClear();
    pathMock.mockClear();
    queryMock.mockClear();
    fieldMapsMock.mockResolvedValue(campaignMap());
  });

  it("creates a campaign card and writes phone config + Voice Brief", async () => {
    const id = await upsertPhoneCampaign({
      name: "Demo",
      phoneId: "686fd112a91849a9e59a5353",
      brief: "Ciao prodotto",
    });
    expect(id).toBeTruthy();
    expect(execMock).toHaveBeenCalledTimes(1);
    const sql = execMock.mock.calls[0][0] as string;
    expect(sql).toContain("INSERT OR IGNORE INTO entries");
    expect(sql).toContain("fld_campaign_name");
    expect(sql).toContain("Demo");
    expect(sql).toContain("fld_voice_brief");
    expect(sql).toContain("Ciao prodotto");
  });

  it("reuses a provided campaignId", async () => {
    const id = await upsertPhoneCampaign({ campaignId: "C-1", phoneId: "p" });
    expect(id).toBe("C-1");
    expect(execMock.mock.calls[0][0]).toContain("'C-1'");
  });
});

describe("loadCampaignPhoneConfig", () => {
  beforeEach(() => {
    queryMock.mockClear();
    fieldMapsMock.mockResolvedValue(campaignMap());
  });

  it("reads the Voice Brief field", async () => {
    queryMock.mockResolvedValue([{ id: "C-1", brief: "Ciao" } as Record<string, string | null>]);
    const cfg = await loadCampaignPhoneConfig("C-1");
    expect(cfg?.brief).toBe("Ciao");
  });

  it("returns null when the campaign is missing", async () => {
    queryMock.mockResolvedValue([]);
    expect(await loadCampaignPhoneConfig("nope")).toBeNull();
  });
});

describe("resolveAudienceForCampaign", () => {
  beforeEach(() => {
    queryMock.mockReset();
    listMembersMock.mockReset();
    fieldMapsMock.mockResolvedValue(campaignMap());
  });

  it("returns phone-compliant people capped by count", async () => {
    queryMock
      .mockResolvedValueOnce([
        { entry_id: "P1", name: "A", email: "a@x", phone: "+1" },
        { entry_id: "P2", name: "B", email: "b@x", phone: "+2" },
        { entry_id: "P3", name: "C", email: "c@x", phone: "+3" },
      ])
      .mockResolvedValue([]);
    const rows = await resolveAudienceForCampaign("C-1", { count: 2 });
    expect(rows.map((r) => r.entry_id)).toEqual(["P1", "P2"]);
  });

  it("scopes to a segment's members when segmentId is provided", async () => {
    queryMock
      .mockResolvedValueOnce([
        { entry_id: "P1", name: "A", email: "a@x", phone: "+1" },
        { entry_id: "P2", name: "B", email: "b@x", phone: "+2" },
      ])
      .mockResolvedValueOnce([{ filter: "{}" }]);
    listMembersMock.mockResolvedValue({
      total: 1,
      members: [
        {
          entry_id: "P1",
          name: "A",
          email: "a@x",
          source: "CRM",
          email_status: "Valid",
          strength_score: null,
          last_interaction_at: null,
        },
      ],
    });
    const rows = await resolveAudienceForCampaign("C-1", { segmentId: "S-1" });
    expect(rows.map((r) => r.entry_id)).toEqual(["P1"]);
  });
});

describe("createPhonePearlForCampaign", () => {
  beforeEach(() => {
    queryMock.mockReset();
    createVoicePearlMock.mockClear();
    resolveVoiceIdMock.mockClear();
    fieldMapsMock.mockResolvedValue(campaignMap());
  });

  it("defaults the voice brief to the campaign's Voice Brief", async () => {
    queryMock.mockResolvedValue([
      {
        pearlId: null,
        phoneId: "686fd112a91849a9e59a5353",
        brief: "Ciao prodotto",
        windowStart: null,
        windowEnd: null,
        timezone: null,
        daysRaw: null,
        maxAttempts: null,
        retryRate: null,
        agentCount: null,
      } as Record<string, string | null>,
    ]);
    const pearlId = await createPhonePearlForCampaign("C-1", "https://origin");
    expect(pearlId).toBe("pearl-1");
    expect(createVoicePearlMock).toHaveBeenCalledTimes(1);
    const payload = createVoicePearlMock.mock.calls[0][0] as {
      nodes?: Array<{ nodeId: string; instructions?: string }>;
    };
    const speak = payload.nodes?.find((n) => n.nodeId === "speak");
    expect(speak?.instructions).toContain("Ciao prodotto");
  });
});
```

### apps/web/app/api/campaigns/phone/route.ts — MODIFY (Slice 4)
Azione `upsert` + threading brief (create) e criteria (send), backward-compatible.

```ts
import {
  createPhonePearlForCampaign,
  enqueuePhoneCampaign,
  setCampaignPearlPaused,
  upsertPhoneCampaign,
  type PhoneAudienceCriteria,
} from "@/lib/campaign-phone";
import { isPhoneWebhookAuthorized } from "@/lib/phone-webhook";
import { resolveAppPublicOrigin } from "@/lib/public-origin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ACTIONS = ["upsert", "create", "send", "pause", "resume"] as const;
type Action = (typeof ACTIONS)[number];

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}
function asNumber(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) { return v; }
  if (typeof v === "string" && v.trim() !== "") { const n = Number(v); return Number.isFinite(n) ? n : undefined; }
  return undefined;
}
function asDays(v: unknown): number[] | undefined {
  if (Array.isArray(v)) { const d = v.filter((x) => typeof x === "number").map((x) => Number(x)); return d.length ? d : undefined; }
  return undefined;
}
function parseAudienceCriteria(v: unknown): PhoneAudienceCriteria | undefined {
  if (!v || typeof v !== "object") { return undefined; }
  const o = v as Record<string, unknown>;
  const segmentId = asString(o.segmentId);
  const count = asNumber(o.count);
  if (!segmentId && count === undefined) { return undefined; }
  return { segmentId, count };
}

export async function POST(req: Request) {
  if (!isPhoneWebhookAuthorized(req)) { return jsonError("Unauthorized", 401); }
  let body: Record<string, unknown>;
  try { body = (await req.json()) as Record<string, unknown>; } catch { return jsonError("Invalid JSON body.", 400); }
  const action = typeof body.action === "string" ? (body.action as Action) : "";
  if (!ACTIONS.includes(action as Action)) { return jsonError(`Unknown action '${String(action)}'.`, 400); }
  const campaignId = asString(body.campaignId) ?? "";
  const origin = resolveAppPublicOrigin(req);
  const brief = asString(body.brief);
  const criteria = parseAudienceCriteria(body.criteria);

  if (action === "upsert") {
    try {
      const result = await upsertPhoneCampaign({
        campaignId: campaignId || undefined,
        name: asString(body.name),
        phoneId: asString(body.phoneId),
        windowStart: asString(body.windowStart),
        windowEnd: asString(body.windowEnd),
        timezone: asString(body.timezone),
        days: asDays(body.days),
        maxAttempts: asNumber(body.maxAttempts),
        retryRate: asNumber(body.retryRate),
        agentCount: asNumber(body.agentCount),
        brief,
      });
      return Response.json({ ok: true, campaignId: result });
    } catch (err) {
      return jsonError(err instanceof Error ? err.message : "Upsert failed.", 500);
    }
  }

  if (!campaignId) { return jsonError("campaignId is required.", 400); }

  try {
    switch (action) {
      case "create": {
        const pearlId = brief
          ? await createPhonePearlForCampaign(campaignId, origin, brief)
          : await createPhonePearlForCampaign(campaignId, origin);
        return Response.json({ ok: true, pearlId });
      }
      case "send": {
        const result = criteria
          ? await enqueuePhoneCampaign(campaignId, criteria)
          : await enqueuePhoneCampaign(campaignId);
        return Response.json({ ok: true, ...result });
      }
      case "pause": {
        await setCampaignPearlPaused(campaignId, true);
        return Response.json({ ok: true, paused: true });
      }
      case "resume": {
        await setCampaignPearlPaused(campaignId, false);
        return Response.json({ ok: true, paused: false });
      }
      default:
        return jsonError("Unhandled action.", 500);
    }
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "Phone campaign failed.", 500);
  }
}
```

### apps/web/app/api/campaigns/phone/route.test.ts — MODIFY (Slice 4)
Aggiunte (mock upsert + 3 test) — su base del test esistente.

```ts
// Nel factory vi.mock("@/lib/campaign-phone", ...) aggiungere:
//   upsertPhoneCampaign: vi.fn(async (input: { campaignId?: string }) => input?.campaignId ?? "C-new"),

// Import nuovi:
//   upsertPhoneCampaign,
// ... e dopo i mocked esistenti:
//   const mockedUpsert = vi.mocked(upsertPhoneCampaign);

// Nuovi test nel describe "POST /api/campaigns/phone":

it("upsert creates a card and returns its id", async () => {
  const res = await POST(post({ action: "upsert", name: "Demo", phoneId: "p", brief: "hi" }));
  expect(res.status).toBe(200);
  const p = await res.json();
  expect(p.ok).toBe(true);
  expect(p.campaignId).toBe("C-new");
  expect(mockedUpsert).toHaveBeenCalledWith(expect.objectContaining({ name: "Demo", phoneId: "p", brief: "hi" }));
});

it("create passes brief when provided", async () => {
  await POST(post({ action: "create", campaignId: "c1", brief: "ciao" }));
  expect(mockedCreate).toHaveBeenCalledWith("c1", "https://crm.example.net", "ciao");
});

it("send passes criteria", async () => {
  await POST(post({ action: "send", campaignId: "c1", criteria: { segmentId: "S1", count: 5 } }));
  expect(mockedEnqueue).toHaveBeenCalledWith("c1", { segmentId: "S1", count: 5 });
});
```

### extensions/crm-a-nlpearl-outbound/index.ts — NEW
Tool `crm_a_phone_campaign` (AnyAgentTool) + register().

```ts
/**
 * Crm-A Console — NLPearl outbound phone campaign agent tool.
 *
 * Registers `crm_a_phone_campaign`, which lets the chat agent drive
 * outbound phone campaigns end-to-end by calling the existing
 * `POST /api/campaigns/phone` route on the local web app:
 *
 *   upsert  → create/update the campaign card (name, phone config, Voice Brief)
 *   create  → build the NLPearl Voice Pearl (paused; no dialing)
 *   send    → enqueue the phone-compliant audience as NLPearl leads
 *   pause / resume → toggle Pearl activity
 *
 * Safety: `send` and `resume` (which starts dialing) REQUIRE the caller to
 * pass `confirm: true`, else the tool refuses. The agent must ask the
 * operator for explicit confirmation before sending leads or activating.
 *
 * Auth: reuses `CRM_A_PHONE_WEBHOOK_SECRET` (the same secret the route
 * validates) read from the shared env. If not set the tool is not
 * registered — mirroring how other extensions gate on a missing key.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { AnyAgentTool } from "openclaw/plugin-sdk";

export const id = "crm-a-nlpearl-outbound";

const TOOL_NAME = "crm_a_phone_campaign";
const DEFAULT_WEB_PORT = 3100;
const PROCESS_JSON_REL = path.join("web-runtime", "process.json");
const CALL_TIMEOUT_MS = 60_000;

type UnknownRecord = Record<string, unknown>;

function readString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}
function readNumber(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}
function asRecord(v: unknown): UnknownRecord | undefined {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as UnknownRecord) : undefined;
}

function resolveStateDir(): string {
  const fromEnv = process.env.OPENCLAW_STATE_DIR?.trim();
  if (fromEnv) { return fromEnv; }
  return path.join(process.env.OPENCLAW_HOME?.trim() || homedir(), ".openclaw-crm-a");
}

function resolvePortFromProcessFile(stateDir: string): number | undefined {
  try {
    const p = path.join(stateDir, PROCESS_JSON_REL);
    if (!existsSync(p)) { return undefined; }
    const parsed = JSON.parse(readFileSync(p, "utf-8")) as UnknownRecord;
    return readNumber(parsed?.port);
  } catch {
    return undefined;
  }
}

function resolveWebBaseUrl(): string {
  const fromEnv = readString(process.env.CRM_A_CONSOLE_WEB_BASE_URL);
  if (fromEnv) { return fromEnv.replace(/\/$/, ""); }
  const port = resolvePortFromProcessFile(resolveStateDir()) ?? DEFAULT_WEB_PORT;
  return `http://127.0.0.1:${port}`;
}

function phoneWebhookSecret(): string | undefined {
  return process.env.CRM_A_PHONE_WEBHOOK_SECRET?.trim() || undefined;
}

const ACTIONS = ["upsert", "create", "send", "pause", "resume"] as const;

const PHONE_CAMPAIGN_PARAMETERS = {
  type: "object",
  additionalProperties: false,
  properties: {
    action: {
      type: "string",
      enum: [...ACTIONS],
      description:
        "upsert: create/update the campaign card. create: build the NLPearl Pearl (paused). send: enqueue leads (requires confirm:true). pause/resume: toggle Pearl activity (resume requires confirm:true).",
    },
    campaignId: {
      type: "string",
      description: "Campaign entry id; omit on upsert to create a new card, or provide to update.",
    },
    name: { type: "string", description: "Campaign name." },
    phoneId: { type: "string", description: "NLPearl outbound-authorized Phone ID." },
    windowStart: { type: "string", description: "Calling window start (HH:MM)." },
    windowEnd: { type: "string", description: "Calling window end (HH:MM)." },
    timezone: { type: "string", description: "IANA timezone (e.g. Europe/Rome)." },
    days: { type: "array", items: { type: "number" }, description: "Calling days (1=Mon..7=Sun)." },
    maxAttempts: { type: "number", description: "Max call attempts (route caps at 5)." },
    retryRate: { type: "number", description: "Minimum retry interval hours." },
    agentCount: { type: "number", description: "Concurrent agents." },
    brief: { type: "string", description: "Voice Brief: the offer the Pearl should communicate (product + comparisons)." },
    criteria: {
      type: "object",
      additionalProperties: false,
      properties: {
        segmentId: { type: "string", description: "Restrict to a CDP segment (phone-compliant members)." },
        count: { type: "number", description: "Cap the number of leads (default 500)." },
      },
      description: "Audience criteria for send: segment + count over the mandatory opt-in/phone-compliance filter.",
    },
    confirm: { type: "boolean", description: "MUST be true to run send or resume; anything else refuses the action." },
  },
  required: ["action"],
} as const;

function jsonResult(payload: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
    details: payload as Record<string, unknown>,
  };
}

async function callPhoneRoute(
  webBaseUrl: string,
  secret: string,
  body: Record<string, unknown>,
): Promise<{ status: number; body: UnknownRecord }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);
  try {
    const res = await fetch(`${webBaseUrl}/api/campaigns/phone`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    let parsed: UnknownRecord = {};
    if (text.trim()) {
      try { parsed = JSON.parse(text) as UnknownRecord; } catch { parsed = { error: text.slice(0, 240) }; }
    }
    return { status: res.status, body: parsed };
  } finally {
    clearTimeout(timer);
  }
}

function createPhoneCampaignTool(webBaseUrl: string, secret: string): AnyAgentTool {
  return {
    name: TOOL_NAME,
    label: "NLPearl outbound phone campaign",
    description:
      "Drive an NLPearl outbound voice campaign from chat. upsert: create/update the campaign card (name, phone config, Voice Brief). create: build the NLPearl Pearl on NLPearl (paused, nothing dialed yet). send: enqueue the phone-compliant audience as NLPearl leads. pause/resume: pause or activate the Pearl. send and resume (which start dialing) require the operator's explicit confirmation (confirm: true).",
    parameters: PHONE_CAMPAIGN_PARAMETERS,
    async execute(_toolCallId: string, input: UnknownRecord) {
      const action = readString(input.action);
      if (!action) {
        return jsonResult({ error: "action is required: upsert|create|send|pause|resume" });
      }
      const confirm = input.confirm === true;
      if ((action === "send" || action === "resume") && !confirm) {
        return jsonResult({
          error: `Refusing to ${action} without confirmation. Ask the operator to confirm, then call again with confirm: true.`,
          needsConfirmation: true,
        });
      }

      const body: Record<string, unknown> = { action };
      if (action !== "upsert") {
        const campaignId = readString(input.campaignId);
        if (!campaignId) {
          return jsonResult({ error: "campaignId is required for this action." });
        }
        body.campaignId = campaignId;
      } else {
        if (readString(input.campaignId)) { body.campaignId = readString(input.campaignId); }
        for (const k of ["name", "phoneId", "windowStart", "windowEnd", "timezone", "brief"] as const) {
          const v = readString(input[k]);
          if (v) { body[k] = v; }
        }
        if (Array.isArray(input.days)) { body.days = input.days.filter((d) => typeof d === "number"); }
        for (const k of ["maxAttempts", "retryRate", "agentCount"] as const) {
          const n = typeof input[k] === "number" ? input[k] : Number(input[k]);
          if (Number.isFinite(n)) { body[k] = n; }
        }
      }
      if (action === "create" && readString(input.brief)) { body.brief = readString(input.brief); }
      if (action === "send" && asRecord(input.criteria)) {
        const c = asRecord(input.criteria) as UnknownRecord;
        const criteria: Record<string, unknown> = {};
        if (readString(c.segmentId)) { criteria.segmentId = readString(c.segmentId); }
        if (typeof c.count === "number") { criteria.count = c.count; }
        if (Object.keys(criteria).length > 0) { body.criteria = criteria; }
      }

      try {
        const { status, body: resBody } = await callPhoneRoute(webBaseUrl, secret, body);
        if (status >= 400) {
          return jsonResult({ error: resBody.error ?? `Campaign ${action} failed (HTTP ${status}).` });
        }
        return jsonResult(resBody);
      } catch (err) {
        return jsonResult({ error: `Campaign ${action} request failed: ${err instanceof Error ? err.message : String(err)}` });
      }
    },
  } as AnyAgentTool;
}

export default function register(api: any) {
  const rootConfig = asRecord(api?.config);
  const pluginEntries = asRecord(asRecord(rootConfig?.plugins)?.entries);
  const pluginConfig = asRecord(asRecord(pluginEntries?.[id])?.config);
  if (pluginConfig?.enabled === false) { return; }

  const secret = phoneWebhookSecret();
  if (!secret) {
    api.logger?.info?.(
      `[crm-a-nlpearl-outbound] CRM_A_PHONE_WEBHOOK_SECRET not set; tool not registered.`,
    );
    return;
  }
  const webBaseUrl = resolveWebBaseUrl();
  api.registerTool(createPhoneCampaignTool(webBaseUrl, secret), {
    name: TOOL_NAME,
    optional: true,
  });
  api.logger?.info?.(`[crm-a-nlpearl-outbound] registered ${TOOL_NAME} (web: ${webBaseUrl})`);
}
```

### extensions/crm-a-nlpearl-outbound/openclaw.plugin.json — NEW

```json
{
  "id": "crm-a-nlpearl-outbound",
  "name": "Crm-A NLPearl Outbound",
  "version": "1.0.0",
  "description": "Registers crm_a_phone_campaign: create/update an outbound phone campaign card and drive NLPearl (Pearl create, lead enqueue, pause/resume) from chat. send/activate require explicit operator confirmation.",
  "activation": { "onStartup": true },
  "contracts": {
    "tools": ["crm_a_phone_campaign"]
  },
  "configSchema": {
    "type": "object",
    "additionalProperties": false,
    "properties": { "enabled": { "type": "boolean", "default": true } },
    "required": []
  }
}
```

### extensions/crm-a-nlpearl-outbound/package.json — NEW

```json
{
  "name": "@crm-a-console/crm-a-nlpearl-outbound",
  "version": "1.0.0",
  "private": true,
  "openclaw": {
    "extensions": [
      "./index.mjs"
    ]
  }
}
```

### extensions/crm-a-nlpearl-outbound/index.mjs — NEW
Bundle compilato (build artifact, non da scrivere a mano — precedente eddbf6905).

```js
// Build artifact: bundle ESM compilato da index.ts (tsdown/build-crm-a-plugins).
// NON da modificare a mano. package.json `openclaw.extensions` punta qui (./index.mjs).
```

### src/cli/bootstrap-external.ts — MODIFY (Slice 6)
Registra `crm-a-nlpearl-outbound` in `managedBundledPlugins` (copies + allowlist seed via `syncBundledPlugins`).

```ts
// In `managedBundledPlugins: BundledPluginSpec[]` (src/cli/bootstrap-external.ts), dopo l'entry exa-search:
    {
      pluginId: "crm-a-nlpearl-outbound",
      sourceDirName: "crm-a-nlpearl-outbound",
      enabled: true,
    },
```

### WEBHOOK-PHONE-CONTRACT.md — MODIFY (Slice 6)
Estendi il contract con il tool + gate confirm.

```md
## Agent tool: crm_a_phone_campaign (outbound dalla chat)

- Estensione `crm-a-nlpearl-outbound` registra il tool `crm_a_phone_campaign`.
- Chiama `POST /api/campaigns/phone` (azioni upsert/create/send/pause/resume) con Bearer = `CRM_A_PHONE_WEBHOOK_SECRET`.
- `send` e `resume` richiedono `confirm: true` obbligatorio (altrimenti `needsConfirmation`) — mai chiamate automatiche.
- `upsert` crea/aggiorna la scheda campagna: Name, Nlpearl Phone ID, finestra/TZ/days, Max Attempts, Retry Rate, Agent Count, Voice Brief.
- `create` passa il `brief` (Voice Brief) al Pearl: la voce parla di prodotto/comparazioni della scheda.
- `send` accetta criteri audience `{ segmentId?, count? }` sopra il filtro di compliance obbligatorio (opt-in + pref=telefono).
```

### DEMO-RUNBOOK.md — MODIFY (Slice 6)
Sezione demo "crea campagna outbound chattando".

```md
## Crea una campagna outbound chattando con l'agente

L'operatore digita: "crea una campagna outbound per il Galaxy, con una breve comparazione rispetto al modello precedente, chiama chi preferisce il telefono".

1. `crm_a_phone_campaign` upsert → crea/aggiorna la scheda (prodotto, comparazioni→Voice Brief, config telefono) → campaignId.
2. `crm_a_phone_campaign` create → crea il Pearl NLPearl (PAUSED, nessuna chiamata).
3. `crm_a_phone_campaign` send → anteprima + conferma operatore → enqueua i lead compliant (conferma richiesta).
4. `crm_a_phone_campaign` resume (= activate) → conferma operatore → il Pearl inizia a chiamare.

Regole: send/activate SEMPRE dietro conferma esplicita (`confirm: true`); MAI numeri seed/demo; callback webhook richiedono origin pubblico (`CRM_A_CONSOLE_PUBLIC_URL` o tunnel) per essere collaudabili.
```

## Slices

### Slice 1: Schema — Voice Brief + External ID

**Files**: `apps/web/lib/workspace-schema-migrations.ts`, `apps/web/lib/workspace-schema-migrations.test.ts`

#### Automated Verification:
- [ ] Tests pass: `pnpm --dir apps/web test workspace-schema-migrations`
- [ ] Grep: `grep -rn "Voice Brief" apps/web/lib/workspace-schema-migrations.ts | wc -l` returns >= 1
- [ ] Grep: `grep -rn "CAMPAIGN_SEND_NEW_FIELDS" apps/web/lib/workspace-schema-migrations.ts | wc -l` returns >= 2 (definition + call-site :1423)

#### Manual Verification:
- [ ] Voice Brief appears under the campaign object after a fresh boot/migration
- [ ] campaign_send has an External ID field so lead-webhook status updates resolve rows

### Slice 2: Backend card upsert + lettura brief

**Files**: `apps/web/lib/campaign-phone.ts`, `apps/web/lib/campaign-phone.test.ts`

#### Automated Verification:
- [ ] Tests pass: `pnpm --dir apps/web test campaign-phone`
- [ ] Grep: `grep -n "Voice Brief" apps/web/lib/campaign-phone.ts | wc -l` returns >= 2 (SELECT guard + upsert writeField)
- [ ] Grep: `grep -n "upsertPhoneCampaign" apps/web/lib/campaign-phone.ts | wc -l` returns >= 1

#### Manual Verification:
- [ ] A campaign card created via `upsertPhoneCampaign` appears in the CRM with Name + phone config + Voice Brief after boot/migration

### Slice 3: Backend audience criteria + threading brief alla Pearl

**Files**: `apps/web/lib/campaign-phone.ts`, `apps/web/lib/campaign-phone.test.ts`

#### Automated Verification:
- [ ] Tests pass: `pnpm --dir apps/web test campaign-phone`
- [ ] Grep: `grep -n "resolveAudienceForCampaign" apps/web/lib/campaign-phone.ts | wc -l` returns >= 2 (def + enqueue call)
- [ ] Grep: `grep -n "cfg.brief" apps/web/lib/campaign-phone.ts | wc -l` returns >= 1
- [ ] Grep: `grep -c "Segment not found." apps/web/lib/campaign-phone.ts` returns >= 1

#### Manual Verification:
- [ ] `send` with a campaign whose Segment relation is set enqueues only that segment's phone-compliant members, capped by count

#### Fit
Reused: CDP `listSegmentMembers`/`SegmentDefinition`/v_segment.Filter (`campaigns.ts:103-157`, `segments.ts:129`), relation `campaign.Segment` (`schema.sql:559`). New: `PhoneAudienceCriteria`, `resolveAudienceForCampaign` (export), `enqueuePhoneCampaign(campaignId, criteria?)`, `briefContent` fallback. Convention: throw "Segment not found." allineato a `campaigns.ts:103`.

### Slice 4: Route — upsert + threading criteri

**Files**: `apps/web/app/api/campaigns/phone/route.ts`, `apps/web/app/api/campaigns/phone/route.test.ts`

#### Automated Verification:
- [ ] Tests pass: `pnpm --dir apps/web test campaigns/phone`
- [ ] Grep: `grep -n "upsert" apps/web/app/api/campaigns/phone/route.ts | wc -l` returns >= 2 (ACTIONS + branch + import)
- [ ] Grep: `grep -n "parseAudienceCriteria" apps/web/app/api/campaigns/phone/route.ts | wc -l` returns >= 1

#### Manual Verification:
- [ ] `curl -X POST .../api/campaigns/phone` con `{"action":"upsert","name":"Demo","phoneId":"p","brief":"hi"}` e Bearer restituisce un campaignId
- [ ] `create` con brief e `send` con criteria vengono accettati e thread-through

#### Fit
Reused: route esistente (`route.ts:34`), auth `isPhoneWebhookAuthorized`, `resolveAppPublicOrigin`, exports Slice 2/3. New: azione `upsert` + helper `asString/asNumber/asDays/parseAudienceCriteria`. Convention: `{ error }` + status HTTP (same script jsonError).

### Slice 5: Estensione OpenClaw + tool

**Files**: `extensions/crm-a-nlpearl-outbound/index.ts`, `extensions/crm-a-nlpearl-outbound/openclaw.plugin.json`, `extensions/crm-a-nlpearl-outbound/package.json`, `extensions/crm-a-nlpearl-outbound/index.mjs`

#### Automated Verification:
- [ ] Grep: `grep -rn "crm_a_phone_campaign" extensions/crm-a-nlpearl-outbound/index.ts extensions/crm-a-nlpearl-outbound/openclaw.plugin.json | wc -l` returns >= 2 (const TOOL_NAME + contracts.tools)
- [ ] Grep: `grep -n "confirm" extensions/crm-a-nlpearl-outbound/index.ts | wc -l` returns >= 2 (params + execute gate)
- [ ] Grep: `grep -n "CRM_A_PHONE_WEBHOOK_SECRET" extensions/crm-a-nlpearl-outbound/index.ts | wc -l` returns >= 1
- [ ] Grep: `grep -c "openclaw" extensions/crm-a-nlpearl-outbound/package.json` returns >= 1
- [ ] Grep: `grep -n "onStartup\|contracts" extensions/crm-a-nlpearl-outbound/openclaw.plugin.json | wc -l` returns >= 2

#### Manual Verification:
- [ ] `extensions/crm-a-nlpearl-outbound/` contiene index.ts + openclaw.plugin.json (activation.onStartup + contracts.tools) + package.json (openclaw.extensions → ./index.mjs) + index.mjs
- [ ] Nel code del tool, `send`/`resume` rifiutano senza `confirm: true` (gate `needsConfirmation` presente)

#### Fit
Reused: `AnyAgentTool` + `registerTool(tool,{name,optional:true})` (`sync-refresh-tools.ts:245`), `register()` enabled-gate (`exa-search/index.ts:300`), `resolveWebBaseUrl`/sidecar (`sync-trigger.ts:100-140`), manifest contracts.tools (`crm-a-ai-gateway/openclaw.plugin.json`), bundle index.mjs + package `openclaw.extensions` (exa-search/package.json), secret condiviso (`phone-webhook.ts:38`). New: 4 file estensione + tool crm_a_phone_campaign.

### Slice 6: Registrazione + docs

**Files**: `src/cli/bootstrap-external.ts`, `WEBHOOK-PHONE-CONTRACT.md`, `DEMO-RUNBOOK.md`

#### Automated Verification:
- [ ] Tests pass: `pnpm test`
- [ ] Type check (src/cli + plugins, copre bootstrap-external.ts): `tsc --noEmit -p tsconfig.json`
- [ ] Type check (web): `tsc --noEmit -p apps/web/tsconfig.json`
- [ ] Lint: `pnpm lint`
- [ ] Grep: `grep -rn "crm-a-nlpearl-outbound" src/cli/bootstrap-external.ts | wc -l` returns >= 1

#### Manual Verification:
- [ ] Fresh install seeds `crm-a-nlpearl-outbound` into plugins.allow (merge) and loads the bundled index.mjs
- [ ] Tool `crm_a_phone_campaign` appears in the agent tool list after boot (with `CRM_A_PHONE_WEBHOOK_SECRET` set)
- [ ] Docs (contract + runbook) reflect the tool, confirm-gate, upsert, and audience criteria
- [ ] Demo end-to-end: chat upsert → create (Pearl paused) → send (confirm) → activate (confirm)

#### Fit
Reused: `managedBundledPlugins` (`bootstrap-external.ts:3426`), spec shape `{pluginId,sourceDirName,enabled}` (come `crm-a-identity`), `syncBundledPlugins` (copia+allow/loadPaths). New: 1 entry + docs. Convention: docs-alongside-feature (`e0d6324b1`), conventional commit `feat(nlpearl):`/`docs(runbook):`.

## Desired End State

L'operatore digita in chat: *"crea una campagna outbound per il Galaxy, con una breve comparazione rispetto al modello precedente, chiama chi preferisce il telefono"*.

L'agente:
1. chiama `crm_a_phone_campaign` con `action=upsert`, `name=...`, `product=...`, `comparisons=...`, `phoneId=...`, `brief=...` → riceve `campaignId`;
2. chiama `crm_a_phone_campaign` con `action=create`, `campaignId` → crea il Pearl NLPearl paused, ritorna `pearlId`;
3. (mostra anteprima audience) chiama con `action=send`, `campaignId`, `criteria={segment,count}`, `confirm:true` → enqueua i lead e ritorna `leadsCreated`;
4. su richiesta esplicita, `action=activate`, `confirm:true`.

Ogni esito lead aggiorna `campaign_send.Status` via webhook (External ID).

## File Map

```
### apps/web/lib/workspace-schema-migrations.ts          # MODIFY — Voice Brief + CAMPAIGN_SEND_NEW_FIELDS (External ID)
apps/web/lib/workspace-schema-migrations.test.ts     # NEW — regressione schema
apps/web/lib/campaign-phone.ts                       # MODIFY — upsert card, brief read, audience criteria
apps/web/lib/campaign-phone.test.ts                  # MODIFY — test upsert/brief/audience
apps/web/app/api/campaigns/phone/route.ts            # MODIFY — azione upsert + threading
apps/web/app/api/campaigns/phone/route.test.ts       # MODIFY — casi upsert/criteri
extensions/crm-a-nlpearl-outbound/index.ts           # NEW — tool crm_a_phone_campaign
extensions/crm-a-nlpearl-outbound/openclaw.plugin.json # NEW — manifest
extensions/crm-a-nlpearl-outbound/package.json       # NEW — package
extensions/crm-a-nlpearl-outbound/index.mjs          # NEW — bundle compilato
src/cli/bootstrap-external.ts                        # MODIFY — registrazione estensione
WEBHOOK-PHONE-CONTRACT.md                            # MODIFY — contract tool + gate confirm
DEMO-RUNBOOK.md                                      # MODIFY — sezione demo outbound chat
```

## Ordering Constraints

- Schema (S1) → backend (S2→S3) → route (S4) → estensione (S5) → registrazione/docs (S6), sequenziale.
- Il bundle `index.mjs` (S5) si genera dal build; non va scritto a mano come codice sorgente (segue eddbf6905). Può essere segnaposto/build-artifact.
- Nessun passo parallelo: ogni slice dipende dalla precedente.

## Verification Notes

- NLPearl è un contratto esterno: i fix storici (0d612f0b8, 1996fef01, 6dfd4b139) insegnano che i payload create devono essere **live-validati paused** prima della route. Qui il `create` resta l'azione che crea la Pearl; `send`/`activate` sono separati e confermati.
- Gate E2E: callback webhook richiedono un origin pubblico (`CRM_A_CONSOLE_PUBLIC_URL` o tunnel). Verifica con `curl` esterno verso `/api/nlpearl/webhook/call?token=...`.
- Campi test attuali: `pnpm --dir apps/web test`, `tsc --noEmit -p apps/web/tsconfig.json`, `npx oxlint --type-aware apps/web/...`, `src/cli` bootstrap non compilato tipizzato senza build (verificare).
- Precedente Apollo/NLPearl: assumere il contratto esterno sbagliato finché live-validato; tenere la normalizzazione nel client, non nell'agente.

## Performance Considerations

- `enqueuePhoneCampaign` fa una POST NLPearl per lead (serial). Con audience grande, considerare batching/pooling; per la demo la dimensione è piccola (LIMIT 500, tipicamente pochi lead) — nessuna ottimizzazione richiesta in v1.
- `resolveAudienceForCampaign` esegue una query DuckDB; accettare un `count` cap per limitare l'enqueue.
- Il tool non carica payload pesanti: passa solo id/config/brief.

## Migration Notes

- Schema: aggiunta di un campo (`Voice Brief`) a `CAMPAIGN_NEW_FIELDS` e di `CAMPAIGN_SEND_NEW_FIELDS` — entrambi applicati dalle migration esistenti (idempotenti) al boot. Nessuna migrazione dati retroattiva richiesta.
- Rollback: se il campo `Voice Brief` manca, `loadCampaignPhoneConfig` lo tratta come assente (guardato) → nessuna rottura.

## Pattern References

- `extensions/crm-a-ai-gateway/sync-refresh-tools.ts:142-242` — tool AnyAgentTool che chiama route app (modello).
- `extensions/crm-a-ai-gateway/sync-trigger.ts:131-262` — resolveWebBaseUrl + Bearer fetch (modello auth/URL).
- `extensions/exa-search/index.ts:237-339` — factory tool + jsonResult.
- `extensions/exa-search/openclaw.plugin.json` — manifest minimale.
- `extensions/crm-a-ai-gateway/openclaw.plugin.json` — manifest con attivazione + contracts.tools.
- `src/cli/bootstrap-external.ts:3427-3466` — BundledPluginSpec registry.

## Developer Context

Checkpoint Step 4:
- G1 Scope: l'operatore ha chiesto "aiutami a scegliere per la DEMO" → raccomandato e confermato "Flusso completo scoped" (un tool crea scheda + Pearl + audience, send/activate confermati).
- G2 Brief: scelto "Campo Voice Brief su campaign" (compilato dall'agente da chat).
- G3 Audience: scelto "Criteri agent su base compliant" (segmento/count sopra opt-in+pref=telefono), con fix resolveAudienceForCampaign(campaignId).
- G4 Bug: scelto "Includi fix External ID".
- G6 Conferma: scelto "Confirm obbligatorio nel tool" (enforcement).
- Directional confirm: pattern estensioni / riusa /api/campaigns/phone / segreto telefono esistente / naming crm_a_* — tutti "follow".

## Design History

- Slice 1: Schema — approved as generated
- Slice 2: Backend card upsert + lettura brief — approved as generated
- Slice 3: Backend audience criteria + threading brief — approved as generated
- Slice 4: Route upsert + threading — approved as generated
- Slice 5: Estensione OpenClaw + tool — approved as generated
- Slice 6: Registrazione + docs — approved as generated
- Slice 2: Backend card upsert + lettura brief — pending
- Slice 3: Backend audience criteria + threading brief — pending
- Slice 4: Route upsert + threading — pending
- Slice 5: Estensione OpenClaw + tool — pending
- Slice 6: Registrazione + docs — pending

## References

- Nessun artifact di ricerca/soluzioni upstream (`.rpiv/artifacts/` vuoto). La base è l'explore in sessione (approcci A–D, raccomandazione D) + ricerca mirata del design.
- `apps/web/lib/nlpearl.ts`, `apps/web/lib/campaign-phone.ts`, `apps/web/lib/phone-webhook.ts`, `apps/web/app/api/campaigns/phone/route.ts`, `apps/web/lib/public-origin.ts`.
- Precedenti git: 0d612f0b8, 1996fef01, 6dfd4b139 (contratto Pearl), e0d6324b1 (docs-alongside), eddbf6905 (index.mjs), 045998854 (rename crm_a_*).

## Follow-up (2026-08-12T11:07:06+0200) — advisory approvazione design

Approvato dall'advisor, con rischi da portare avanti in `/skill:plan` e `/skill:implement`.

### CRITICO — propagazione di `CRM_A_PHONE_WEBHOOK_SECRET` nel gateway

Il tool (Slice 5) legge `CRM_A_PHONE_WEBHOOK_SECRET` dal `process.env` del processo del gateway `OpenClaw`, che è spawnato dal CLI con `env: { ...process.env, ...params.env }` (`src/cli/web-runtime.ts:892-894`). Ma:
- il gateway eredita l'env del processo CLI, che **non è garantito** carichi il `.env` della web app;
- `docker-compose.yml` **non inoltra** `CRM_A_PHONE_WEBHOOK_SECRET` (solo OPENROUTER_API_KEY, COMPOSIO_API_KEY, TAILSCALE_*, CRM_A_DEFAULT_MODEL);
- `.env.example` non documenta né `CRM_A_PHONE_WEBHOOK_SECRET` né `NLPEARL_*`.

Conseguenza: se il segreto non è nell'env del gateway, `register()` (Slice 5) logga "secret not set" e **non registra il tool** (feature silenziosamente morta); se valora ≠ web `.env`, ogni call è 401.

**Decisione da prendere al checkpoint di `/skill:plan`**: (a) inoltrare il segreto nel gateway (docker-compose `CRM_A_PHONE_WEBHOOK_SECRET=${...:-}` + riga in `.env.example`), e/o (b) far leggere il segreto all'estensione da una fonte persistente condivisa (es. config dir integrations). Senza risolvere, la demo "tool appare" fallisce.

### MEDIO — timeout enqueue vs dimensione audience

`callPhoneRoute` usa `CALL_TIMEOUT_MS = 60_000` (Slice 5), ma la route `send` esegue `addLead` **serialmente per lead** (`campaign-phone.ts`). Con count vicino a 500 supera di gran lunga i 60s: il tool aborts mentre la route continua in background (row `campaign_send` parziali 'Queued'). Per la demo tenere `count` piccolo (3–5); annotare il mismatch così implement non si sorprende.

### MINORE — baseline root tsc mai eseguita

La baseline di Slice 6 `tsc --noEmit -p tsconfig.json` (root) non è mai stata eseguita durante il design. Se il root tsc ha errori pre-esistenti, quel criterio è impassabile per motivi estranei a questo change. Confermare che compili pulito, o limitare il typecheck ai file cambiati.

