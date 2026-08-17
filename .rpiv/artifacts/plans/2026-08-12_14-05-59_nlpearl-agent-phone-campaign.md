---
date: 2026-08-12T14:05:59+0200
author: andreab
commit: 4d993164d
branch: main
repository: crmaconsole
topic: "Agent-driven NLPearl outbound phone campaign tool"
tags: [plan, nlpearl, extension, agent-tool, outbound, campaign, openclaw]
status: ready
parent: ".rpiv/artifacts/designs/2026-08-12_11-07-06_nlpearl-agent-phone-campaign.md"
phase_count: 6
phases:
  - { n: 1, title: "Schema — Voice Brief + External ID", files: ["apps/web/lib/workspace-schema-migrations.ts", "apps/web/lib/workspace-schema-migrations.test.ts"], depends_on: [] }
  - { n: 2, title: "Backend card upsert + lettura brief", files: ["apps/web/lib/campaign-phone.ts", "apps/web/lib/campaign-phone.test.ts"], depends_on: [1] }
  - { n: 3, title: "Backend audience criteria + threading brief alla Pearl", files: ["apps/web/lib/campaign-phone.ts", "apps/web/lib/campaign-phone.test.ts"], depends_on: [2] }
  - { n: 4, title: "Route — upsert + threading criteri", files: ["apps/web/app/api/campaigns/phone/route.ts", "apps/web/app/api/campaigns/phone/route.test.ts"], depends_on: [3] }
  - { n: 5, title: "Estensione OpenClaw + tool", files: ["extensions/crm-a-nlpearl-outbound/index.ts", "extensions/crm-a-nlpearl-outbound/openclaw.plugin.json", "extensions/crm-a-nlpearl-outbound/package.json", "extensions/crm-a-nlpearl-outbound/index.mjs"], depends_on: [4] }
  - { n: 6, title: "Registrazione + docs + ops env-propagation", files: ["src/cli/bootstrap-external.ts", "WEBHOOK-PHONE-CONTRACT.md", "DEMO-RUNBOOK.md", "docker-compose.yml", ".env.example", "scripts/build-crm-a-plugins.mjs"], depends_on: [5] }
last_updated: 2026-08-12T14:05:59+0200
last_updated_by: andreab
---

# Agent tool → campagne outbound NLPearl dalla chat — Implementation Plan

## Overview

Implementiamo l'estensione OpenClaw `crm-a-nlpearl-outbound` che registra il tool `crm_a_phone_campaign`, permettendo all'agente della chat di strutturare campagne outbound NLPearl da zero: crea/aggiorna la scheda campagna (prodotto, comparazioni→`Voice Brief`, config telefonica), crea la Pearl Voice su NLPearl (paused), definisce l'audience (segmento/count sopra compliance) e invia/attiva i lead — sempre dietro `confirm: true` obbligatorio. Reusa l'orchestrazione e la route `POST /api/campaigns/phone` esistenti, estese con un'azione `upsert` e il threading di brief + criteri audience. Include il fix del bug pre-esistente `CAMPAIGN_SEND_NEW_FIELDS` (External ID) e la propagazione di `CRM_A_PHONE_WEBHOOK_SECRET` al gateway.

Riferimento: design `.rpiv/artifacts/designs/2026-08-12_11-07-06_nlpearl-agent-phone-campaign.md` (status ready, approvato dall'advisor).

## Desired End State

L'operatore digita in chat: *"crea una campagna outbound per il Galaxy, con una breve comparazione rispetto al modello precedente, chiama chi preferisce il telefono"*.

L'agente:
1. chiama `crm_a_phone_campaign` con `action=upsert`, `name=...`, `product=...`, `comparisons=...`, `phoneId=...`, `brief=...` → riceve `campaignId`;
2. chiama `crm_a_phone_campaign` con `action=create`, `campaignId` → crea il Pearl NLPearl paused, ritorna `pearlId`;
3. (mostra anteprima audience) chiama con `action=send`, `campaignId`, `criteria={segment,count}`, `confirm:true` → enqueua i lead e ritorna `leadsCreated`;
4. su richiesta esplicita, `action=activate` (route `resume`), `confirm:true`.

Ogni esito lead aggiorna `campaign_send.Status` via webhook (External ID).

## What We're NOT Doing

- CRUD completo oggetti campagne (solo upsert minimale del percorso phone).
- Upload di lista libera/arbitraria di numeri (bypassa opt-in).
- Modifiche UI alle schede (la scheda resta editabile da CRM UI / skill crm).
- Mirror del plugin nelle Integrations UI (`getIntegrationsState` filtra solo gateway/identity — integrazions.ts:1090 → codice morto; registrazione via bootstrap sufficiente, il tool si auto-disabilita senza segreto).
- Nuovi store di segreti (si riusa `CRM_A_PHONE_WEBHOOK_SECRET`).
- Invio outbound Telegram/email: resta il percorso esclusivamente NLPearl-phone.

## Phase 1: Schema — Voice Brief + External ID

### Overview

Foundation dello schema: aggiunge il campo `Voice Brief` alla scheda campaign e definisce la costante `CAMPAIGN_SEND_NEW_FIELDS` (con `External ID`) che oggi è referenziata ma mai definita — fix del bug che rende il tracking esiti lead un silent no-op.

### Changes Required:

#### 1. Schema migrazioni
**File**: `apps/web/lib/workspace-schema-migrations.ts`
**Changes**: `const CAMPAIGN_NEW_FIELDS` → export e append `Voice Brief` (sortOrder 19); definire `CAMPAIGN_SEND_NEW_FIELDS` (External ID, sortOrder 10) subito dopo.

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

#### 2. Test regressione schema
**File**: `apps/web/lib/workspace-schema-migrations.test.ts` (NEW)
**Changes**: suite vitest che asserpa Voice Brief in CAMPAIGN_NEW_FIELDS, External ID in CAMPAIGN_SEND_NEW_FIELDS, ordinamento sortOrder.

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

### Success Criteria:

#### Automated Verification:
- [x] Tests pass: `pnpm --dir apps/web test workspace-schema-migrations`
- [x] Grep: `grep -rn "Voice Brief" apps/web/lib/workspace-schema-migrations.ts | wc -l` returns >= 1
- [x] Grep: `grep -rn "CAMPAIGN_SEND_NEW_FIELDS" apps/web/lib/workspace-schema-migrations.ts | wc -l` returns >= 2 (definition + call-site :1423)

#### Manual Verification:
- [ ] Voice Brief appears under the campaign object after a fresh boot/migration
- [ ] campaign_send has an External ID field so lead-webhook status updates resolve rows

---

## Phase 2: Backend card upsert + lettura brief

### Overview

`CampaignPhoneConfig` guadagna `brief`; `loadCampaignPhoneConfig` (ora export) legge il campo `Voice Brief`; nuova `upsertPhoneCampaign` crea/aggiorna la scheda campagna + config phone sparendo dal percorso telefono.

### Changes Required:

#### 1. campaign-phone lib
**File**: `apps/web/lib/campaign-phone.ts`
**Changes**: tipo `CampaignPhoneConfig.brief`; `loadCampaignPhoneConfig` export + SELECT `Voice Brief`; nuova `upsertPhoneCampaign`.

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
```

#### 2. Test campaign-phone (base)
**File**: `apps/web/lib/campaign-phone.test.ts` (NEW)
**Changes**: suite per upsert + lettura brief (viene estesa in Phase 3). Mocks `./workspace`, `./crm-queries`.

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
  loadCampaignPhoneConfig,
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
```

### Success Criteria:

#### Automated Verification:
- [x] Tests pass: `pnpm --dir apps/web test campaign-phone`
- [x] Grep: `grep -n "Voice Brief" apps/web/lib/campaign-phone.ts | wc -l` returns >= 2 (SELECT guard + upsert writeField)
- [x] Grep: `grep -n "upsertPhoneCampaign" apps/web/lib/campaign-phone.ts | wc -l` returns >= 1

#### Manual Verification:
- [ ] A campaign card created via `upsertPhoneCampaign` appears in the CRM with Name + phone config + Voice Brief after boot/migration

---

## Phase 3: Backend audience criteria + threading brief alla Pearl

### Overview

`createPhonePearlForCampaign` usa il `Voice Brief` della scheda come default; `resolveAudienceForCampaign(campaignId, criteria)` e `enqueuePhoneCampaign(campaignId, criteria)` scoping audience per segmento/count sopra la base compliant (fix del bug che ignorava campaignId).

### Changes Required:

#### 1. campaign-phone lib (aggiunte)
**File**: `apps/web/lib/campaign-phone.ts`
**Changes**: import `./segments`; `PhoneAudienceCriteria`; `resolveCampaignSegmentId`/`resolveSegmentMemberIds`/`cap`; `resolveAudienceForCampaign(campaignId, criteria)` export; firma `enqueuePhoneCampaign` update; `createPhonePearlForCampaign` default `briefContent = brief ?? cfg.brief`.

```ts
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
       AND MAX(CASE WHEN ef.field_id = '${phoneFld}' THEN ef.value END) != ''`;
  const segmentId = criteria?.segmentId?.trim() || (await resolveCampaignSegmentId(campaignId)) || undefined;
  if (segmentId) {
    // Segment-scoped: risolvi i membri, filtra in memoria e cap (fix concern C3: il LIMIT in SQL vale solo per il path no-segment).
    const rows = await duckdbQueryAsync<{ entry_id: string; name: string | null; email: string | null; phone: string | null }>(`${baseSql};`);
    const members = await resolveSegmentMemberIds(segmentId);
    const scoped = rows.filter((r) => members.has(r.entry_id));
    return scoped.slice(0, cap(criteria));
  }
  // No-segment: il cap va nel SQL per non caricare tutta la popolazione compliant (fix concern C3).
  const limitedSql = `${baseSql} LIMIT ${cap(criteria)};`;
  const rows = await duckdbQueryAsync<{ entry_id: string; name: string | null; email: string | null; phone: string | null }>(limitedSql);
  return rows;
}

#### MODIFY — enqueuePhoneCampaign (firma + pass-through criteri; fix concern C5)
```ts
export async function enqueuePhoneCampaign(
  campaignId: string,
  criteria?: PhoneAudienceCriteria,
): Promise<PhoneCampaignEnqueueResult> {
  const cfg = await loadCampaignPhoneConfig(campaignId);
  if (!cfg) { throw new Error("Campaign not found."); }
  if (!cfg.pearlId) { throw new Error("Campaign has no NLPearl Pearl ID — run createPhonePearlForCampaign first."); }
  if (!isNlpearlConfigured()) { throw new Error("NLPearl not configured."); }

  const dbPath = await duckdbPathAsync();
  if (!dbPath) { throw new Error("DuckDB not found."); }
  const fieldMaps = await loadCrmFieldMaps();

  // UNICA RIGA CAMBIATA (rispetto a HEAD): pass-through criteri
  const audience = await resolveAudienceForCampaign(campaignId, criteria); // ← era resolveAudienceForCampaign()
  // ... resto del corpo invariato (campaign_send rows → addLead loop) ...
}
```

#### MODIFY — createPhonePearlForCampaign (script voce default dal Voice Brief; fix concern C5)
```ts
export async function createPhonePearlForCampaign(
  campaignId: string,
  requestOrigin: string,
  brief?: string,
): Promise<string> {
  // ... corpo invariato ...
  const briefContent = brief ?? cfg.brief ?? undefined; // ← nuova riga: default dal Voice Brief della scheda
  // ... nella node "speak", `instructions` diventa:
  instructions: briefContent
    ? `Contenuto offerta da comunicare:\n${briefContent.trim().slice(0, 8000)}`
    : undefined,
  // ... resto invariato ...
}
```
```

#### 2. Test campaign-phone (estese)
**File**: `apps/web/lib/campaign-phone.test.ts`
**Changes**: aggiunge describe `resolveAudienceForCampaign` (cap + segmento) e `createPhonePearlForCampaign` (brief-default).

```ts
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

### Success Criteria:

#### Automated Verification:
- [x] Tests pass: `pnpm --dir apps/web test campaign-phone`
- [x] Grep: `grep -n "resolveAudienceForCampaign" apps/web/lib/campaign-phone.ts | wc -l` returns >= 2 (def + enqueue call)
- [x] Grep: `grep -n "cfg.brief" apps/web/lib/campaign-phone.ts | wc -l` returns >= 1
- [x] Grep: `grep -c "Segment not found." apps/web/lib/campaign-phone.ts` returns >= 1

#### Manual Verification:
- [ ] `send` with a campaign whose Segment relation is set enqueues only that segment's phone-compliant members, capped by count

---

## Phase 4: Route — upsert + threading criteri

### Overview

La route `POST /api/campaigns/phone` guadagna l'azione `upsert` (crea/aggiorna scheda) e threada `brief` (create) e `criteria` (send), backward-compatible (niente argomenti extra quando assenti).

### Changes Required:

#### 1. Route
**File**: `apps/web/app/api/campaigns/phone/route.ts`
**Changes**: `ACTIONS += "upsert"`; helper `asString/asNumber/asDays/parseAudienceCriteria`; branch `upsert`; threading brief/criteria.

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

#### 2. Test route
**File**: `apps/web/app/api/campaigns/phone/route.test.ts`
**Changes**: mock `upsertPhoneCampaign`; 3 nuovi test (upsert, create-brief, send-criteria).

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

### Success Criteria:

#### Automated Verification:
- [x] Tests pass: `pnpm --dir apps/web test campaigns/phone`
- [x] Grep: `grep -n "upsert" apps/web/app/api/campaigns/phone/route.ts | wc -l` returns >= 2 (ACTIONS + branch + import)
- [x] Grep: `grep -n "parseAudienceCriteria" apps/web/app/api/campaigns/phone/route.ts | wc -l` returns >= 1

#### Manual Verification:
- [ ] `curl -X POST .../api/campaigns/phone` con `{"action":"upsert","name":"Demo","phoneId":"p","brief":"hi"}` e Bearer restituisce un campaignId
- [ ] `create` con brief e `send` con criteria vengono accettati e thread-through

---

## Phase 5: Estensione OpenClaw + tool

### Overview

Nuova estensione `crm-a-nlpearl-outbound` che registra il tool `crm_a_phone_campaign` (AnyAgentTool) — gated su `CRM_A_PHONE_WEBHOOK_SECRET`, con gate di conferma obbligatorio su `send`/`resume`.

### Changes Required:

#### 1. Estensione — tool
**File**: `extensions/crm-a-nlpearl-outbound/index.ts` (NEW)
**Changes**: implementazione completa + `register()`.

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
        count: { type: "number", description: "Cap the number of leads (default 500; segment-scoped audiences are capped at 200 by the CDP member resolver)." },
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

#### 2. Manifest openclaw
**File**: `extensions/crm-a-nlpearl-outbound/openclaw.plugin.json` (NEW)

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

#### 3. Package
**File**: `extensions/crm-a-nlpearl-outbound/package.json` (NEW)

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

#### 4. Bundle placeholder
**File**: `extensions/crm-a-nlpearl-outbound/index.mjs` (NEW)

```js
// Build artifact: bundle ESM compilato da index.ts (tsdown/build-crm-a-plugins).
// NON da modificare a mano. package.json `openclaw.extensions` punta qui (./index.mjs).
```

### Success Criteria:

#### Automated Verification:
- [x] Grep: `grep -rn "crm_a_phone_campaign" extensions/crm-a-nlpearl-outbound/index.ts extensions/crm-a-nlpearl-outbound/openclaw.plugin.json | wc -l` returns >= 2 (const TOOL_NAME + contracts.tools)
- [x] Grep: `grep -n "confirm" extensions/crm-a-nlpearl-outbound/index.ts | wc -l` returns >= 2 (params + execute gate)
- [x] Grep: `grep -n "CRM_A_PHONE_WEBHOOK_SECRET" extensions/crm-a-nlpearl-outbound/index.ts | wc -l` returns >= 1
- [x] Grep: `grep -c "openclaw" extensions/crm-a-nlpearl-outbound/package.json` returns >= 1
- [x] Grep: `grep -n "onStartup\|contracts" extensions/crm-a-nlpearl-outbound/openclaw.plugin.json | wc -l` returns >= 2

#### Manual Verification:
- [ ] `extensions/crm-a-nlpearl-outbound/` contiene index.ts + openclaw.plugin.json (activation.onStartup + contracts.tools) + package.json (openclaw.extensions → ./index.mjs) + index.mjs
- [ ] Nel code del tool, `send`/`resume` rifiutano senza `confirm: true` (gate `needsConfirmation` presente)

---

## Phase 6: Registrazione + docs + ops env-propagation

### Overview

Registra l'estensione in `managedBundledPlugins` (copy + allowlist seed), aggiorna docs (contract + runbook) e risolve la propagazione di `CRM_A_PHONE_WEBHOOK_SECRET` al gateway (forward in docker-compose + documentazione in `.env.example`). Fase terminale: porta le baseline di progetto.

### Changes Required:

#### 1. Registrazione bootstrap
**File**: `src/cli/bootstrap-external.ts`
**Changes**: aggiunge entry a `managedBundledPlugins`.

```ts
// In `managedBundledPlugins: BundledPluginSpec[]` (src/cli/bootstrap-external.ts), dopo l'entry exa-search:
    {
      pluginId: "crm-a-nlpearl-outbound",
      sourceDirName: "crm-a-nlpearl-outbound",
      enabled: true,
    },
```

#### 2. Contract
**File**: `WEBHOOK-PHONE-CONTRACT.md`
**Changes**: estende contract con tool + confirm gate.

```md
## Agent tool: crm_a_phone_campaign (outbound dalla chat)

- Estensione `crm-a-nlpearl-outbound` registra il tool `crm_a_phone_campaign`.
- Chiama `POST /api/campaigns/phone` (azioni upsert/create/send/pause/resume) con Bearer = `CRM_A_PHONE_WEBHOOK_SECRET`.
- `send` e `resume` richiedono `confirm: true` obbligatorio (altrimenti `needsConfirmation`) — mai chiamate automatiche.
- `upsert` crea/aggiorna la scheda campagna: Name, Nlpearl Phone ID, finestra/TZ/days, Max Attempts, Retry Rate, Agent Count, Voice Brief.
- `create` passa il `brief` (Voice Brief) al Pearl: la voce parla di prodotto/comparazioni della scheda.
- `send` accetta criteri audience `{ segmentId?, count? }` sopra il filtro di compliance obbligatorio (opt-in + pref=telefono).
```

#### 3. Runbook
**File**: `DEMO-RUNBOOK.md`
**Changes**: sezione demo "crea campagna outbound chattando".

```md
## Crea una campagna outbound chattando con l'agente

L'operatore digita: "crea una campagna outbound per il Galaxy, con una breve comparazione rispetto al modello precedente, chiama chi preferisce il telefono".

1. `crm_a_phone_campaign` upsert → crea/aggiorna la scheda (prodotto, comparazioni→Voice Brief, config telefono) → campaignId.
2. `crm_a_phone_campaign` create → crea il Pearl NLPearl (PAUSED, nessuna chiamata).
3. `crm_a_phone_campaign` send → anteprima + conferma operatore → enqueua i lead compliant (conferma richiesta).
4. `crm_a_phone_campaign` resume (= activate) → conferma operatore → il Pearl inizia a chiamare.

Regole: send/activate SEMPRE dietro conferma esplicita (`confirm: true`); MAI numeri seed/demo; callback webhook richiedono origin pubblico (`CRM_A_CONSOLE_PUBLIC_URL` o tunnel) per essere collaudabili.
```

#### 4. Ops — env propagation del segreto
**File**: `docker-compose.yml` (MODIFY)
**Changes**: inoltra `CRM_A_PHONE_WEBHOOK_SECRET` al container (decisione del checkpoint di plan, dal Follow-up del design).

```yaml
# Nella sezione `environment:` del servizio crm-a-console, aggiungere (accanto alle altre `${...:-}`):
      - CRM_A_PHONE_WEBHOOK_SECRET=${CRM_A_PHONE_WEBHOOK_SECRET:-}
```

#### 5. Ops — documentazione env
**File**: `.env.example` (MODIFY)
**Changes**: documenta le variabili richieste dal percorso telefonico. **Nota**: seguire la convenzione del file esistente (`export VAR=`), altrimenti `source .env` non le esporta.

```bash
# Phone outbound (NLPearl) — webhook route auth + NLPearl credentials
export CRM_A_PHONE_WEBHOOK_SECRET=
# Il gateway OpenClaw deve vedere lo stesso segreto della web app (forward in docker-compose o env shell)
export NLPEARL_ACCOUNT_ID=
export NLPEARL_SECRET_KEY=
export NLPEARL_BASE_URL=
export NLPEARL_VOICE_ID=
```

#### 6. Ops — bundle build script (blocker 2)
**File**: `scripts/build-crm-a-plugins.mjs` (MODIFY)
**Changes**: aggiunge la nuova estensione all'array `plugins` (oggi hardcoded solo identity+ai-gateway), altrimenti `index.mjs` non viene mai generato e il tool non si registra. Nota: eseguire `pnpm build:crm-a-plugins` prima del commit per generare il bundle committato.

```js
// In scripts/build-crm-a-plugins.mjs, aggiungere la nuova estensione all'array:
const plugins = [
  "extensions/crm-a-identity/index.ts",
  "extensions/crm-a-ai-gateway/index.ts",
  "extensions/crm-a-nlpearl-outbound/index.ts",
];
```

### Success Criteria:

#### Automated Verification:
- [x] Tests pass: `pnpm test`
- [ ] Type check (src/cli + plugins, copre bootstrap-external.ts): `tsc --noEmit -p tsconfig.json` (PRE-ESISTENTE: 39 errori in test/ non miei; i miei file puliti)
- [ ] Type check (web): `tsc --noEmit -p apps/web/tsconfig.json` (PRE-ESISTENTE: errori in test/ non miei; i miei file puliti)
- [ ] Lint: `pnpm lint` (PRE-ESISTENTE: 1126 errori repo-wide; i miei file 0 errori)
- [x] Grep: `grep -rn "crm-a-nlpearl-outbound" src/cli/bootstrap-external.ts | wc -l` returns >= 1
- [x] Grep: `grep -n "CRM_A_PHONE_WEBHOOK_SECRET" docker-compose.yml | wc -l` returns >= 1

#### Manual Verification:
- [ ] Fresh install seeds `crm-a-nlpearl-outbound` into plugins.allow (merge) and loads the bundled index.mjs
- [ ] Tool `crm_a_phone_campaign` appears in the agent tool list after boot (with `CRM_A_PHONE_WEBHOOK_SECRET` set)
- [ ] Docs (contract + runbook) reflect the tool, confirm-gate, upsert, and audience criteria
- [ ] Demo end-to-end: chat upsert → create (Pearl paused) → send (confirm) → activate (confirm)
- [ ] Con `CRM_A_CONSOLE_PUBLIC_URL` (o tunnel) attivo, un `curl` esterno verso `/api/nlpearl/webhook/call?token=...` risolve una row `campaign_send` per `External ID` (coverage A)
- [ ] `send` con `count: 5` ritorna entro `CALL_TIMEOUT_MS` (60s) senza row `campaign_send` parziali 'Queued' (coverage B)

---

## Testing Strategy

### Automated:
- `pnpm test` (root: `src/cli/bootstrap-external.test.ts` + `apps/web`)
- `tsc --noEmit -p tsconfig.json` (src/cli) e `tsc --noEmit -p apps/web/tsconfig.json` (web)
- `pnpm lint` (`oxlint --type-aware`)
- Grep di presenza per i simboli/field nuovi per fase.

### Manual Testing Steps:
1. Boot/migrazione: verificare i nuovi field `Voice Brief` (campaign) e `External ID` (campaign_send) presenti.
2. Route: `curl` `upsert` → campaignId; `create` con brief; `send` con criteria.
3. Estensione: con `CRM_A_PHONE_WEBHOOK_SECRET` valorizzato, il tool appare nella lista tool; `send`/`resume` senza confirm rifiutano.
4. Demo end-to-end: chat upsert → create (Pearl paused) → send (confirm) → activate (confirm), count piccolo (3–5) per il timeout.
5. Gate E2E: origin pubblico (`CRM_A_CONSOLE_PUBLIC_URL` o tunnel) per collaudare i callback webhook.

## Performance Considerations

- `enqueuePhoneCampaign` fa una POST NLPearl per lead (serial). Con audience grande, considerare batching/pooling; per la demo dimensione piccola (LIMIT 500, pochi lead) — nessuna ottimizzazione in v1.
- `resolveAudienceForCampaign` esegue una query DuckDB; accettare un `count` cap per limitare l'enqueue.
- Il tool non carica payload pesanti: passa solo id/config/brief.
- **Nota advisor (medium)**: `callPhoneRoute` usa `CALL_TIMEOUT_MS` 60s ma `send` esegue `addLead` serialmente → tenere `count` piccolo (3–5) in demo.

## Migration Notes

- Schema: aggiunta di `Voice Brief` (campaign) e `CAMPAIGN_SEND_NEW_FIELDS`/`External ID` (campaign_send) — applicati dalle migration idempotenti al boot. Nessuna migrazione dati retroattiva.
- Rollback: se `Voice Brief` manca, `loadCampaignPhoneConfig` lo tratta come assente (guardato) → nessuna rottura.

## Developer Context

- Env-propagation `CRM_A_PHONE_WEBHOOK_SECRET` (rischio critico, Follow-up design): decisione al checkpoint di plan = **forward docker-compose + `.env.example`** (files aggiunti alla Phase 6). Vincolo: il segreto va valorizzato anche nell'env di chi avvia CLI/gateway in locale (documentato in `.env.example`).
- Baseline root `tsc --noEmit -p tsconfig.json` mai eseguita durante il design: se ha errori pre-esistenti, quel criterio di Phase 6 andrà confermato/limitato ai file cambiati.

## References

- Design: `.rpiv/artifacts/designs/2026-08-12_11-07-06_nlpearl-agent-phone-campaign.md`
- Precedenti git: 0d612f0b8, 1996fef01, 6dfd4b139 (contratto Pearl), e0d6324b1 (docs-alongside), eddbf6905 (index.mjs), 045998854 (rename crm_a_*).
- File chiave: `apps/web/lib/nlpearl.ts`, `apps/web/lib/campaign-phone.ts`, `apps/web/lib/phone-webhook.ts`, `apps/web/app/api/campaigns/phone/route.ts`, `apps/web/lib/public-origin.ts`.

## Plan Review (Step 4)

_Independent post-finalization review by artifact-code-reviewer and artifact-coverage-reviewer subagents. Findings triaged at Step 5._

| source   | plan-loc          | codebase-loc                | severity   | dimension             | finding   | recommendation   | resolution         |
| -------- | ----------------- | --------------------------- | ---------- | --------------------- | --------- | ---------------- | ------------------ |
| code     | Phase 2 §2 (campaign-phone.test.ts) | <n/a> | blocker | actionability | Test di Phase 2 importa `resolveAudienceForCampaign` che diventa export solo in Phase 3 → il modulo fallisce il load e ogni test di Phase 2 rompe prima di qualsiasi `it()`. | Rimuovere `resolveAudienceForCampaign` dall'import del test di Phase 2; aggiungerlo in Phase 3 §2 quando il simbolo è export. | applied: Phase 2 import ridotto a loadCampaignPhoneConfig + upsertPhoneCampaign; Phase 3 aggiunge gli import quando il simbolo è export |
| code     | Phase 5 §4 (index.mjs) | scripts/build-crm-a-plugins.mjs:7 | blocker | actionability | `index.mjs` è un placeholder commento e `scripts/build-crm-a-plugins.mjs` compila solo `crm-a-identity`+`crm-a-ai-gateway` (array hardcoded) → il bundle della nuova estensione non è mai generato → `openclaw.extensions` carica un modulo vuoto senza `register` → il tool non viene registrato, rompendo la criteria di Phase 6. | Aggiungere `"extensions/crm-a-nlpearl-outbound/index.ts"` all'array `plugins` di `scripts/build-crm-a-plugins.mjs` (Phase 5 o 6) e documentare che `pnpm build:crm-a-plugins` va eseguito prima del commit. | applied: nuova Changes Required 6 in Phase 6 (build-crm-a-plugins.mjs plugins array) + file aggiunto a files di Phase 6 |
| code     | Phase 3 §1 (campaign-phone.ts) | apps/web/lib/campaign-phone.ts:215 | concern | code-quality | Il base SQL di `resolveAudienceForCampaign` omette il `LIMIT 500` che la versione privata attuale ha → carica tutta la popolazione phone-compliant in memoria prima di `rows.slice(0, cap)`. | Spingere il cap in SQL per il path no-segment (`LIMIT ${cap(criteria)}`) e usare lo slice in memoria solo per il branch segment-scoped. | applied: baseSql senza `;` finale; path no-segment → `LIMIT ${cap(criteria)};`; branch segment usa query in-memory + slice |
| code     | Phase 3 §1 (campaign-phone.ts) | apps/web/lib/segments.ts:140 | concern | code-quality | `resolveSegmentMemberIds` chiama `listSegmentMembers(def, { limit: 2000 })` ma `listSegmentMembers` clamp a `Math.min(200, …)` → audience scoped a segmento cap a 200 indipendentemente da `criteria.count` (divergenza dalla doc "default 500"). | Paginare `listSegmentMembers` (loop con offset fino a `criteria.count` o esaurimento) o documentare il cap 200 nella descrizione di `criteria.count`. | applied: documentato il cap 200 nella descrizione di `criteria.count` nel tool (Phase 5) — paging non necessario per la demo |
| code     | Phase 3 §1 (campaign-phone.ts) | apps/web/lib/campaign-phone.ts:74 | concern | actionability | La firma `enqueuePhoneCampaign`/pass-through criteri e la modifica `briefContent = brief ?? cfg.brief` in `createPhonePearlForCampaign` sono scritte come prosa con `...`, non come blocchi MODIFY fenced. | Sostituire i due snippet di prosa con blocchi MODIFY fenced con la firma + le righe cambiate in contesto, copy-pasteable. | applied: entrambe ora blocchi MODIFY fenced (firma + riga cambiata in contesto) |
| code     | Phase 6 §5 (.env.example) | .env.example:1 | concern | codebase-fit | Le aggiunte `.env.example` usano `VAR=` nudo mentre il file esistente usa la convenzione `export VAR=` (sourceable); `source .env` non esporta le nuove var → docker-compose `${...:-}` e `process.env` non le vedono. | Prefissare ogni riga nuova con `export `. | applied: tutte le righe nuove prefissate con `export ` (riscritte con il blocker 2) |
| coverage | ## Verification Notes §2 | <n/a> | concern | verification-coverage | Nota "callback webhook richiedono origin pubblico ... curl esterno verso /api/nlpearl/webhook/call?token=..." non ha un bullet in `### Success Criteria:` (solo Testing Strategy/runbook). | Aggiungere bullet `#### Manual Verification:` in Phase 6: con `CRM_A_CONSOLE_PUBLIC_URL` (o tunnel), `curl` esterno a `/api/nlpearl/webhook/call?token=...` e confermare che risolve una row `campaign_send` per `External ID`. | applied: bullet Manual in Phase 6 (coverage A) |
| coverage | ## Follow-up §MEDIO | <n/a> | concern | verification-coverage | Follow-up "CALL_TIMEOUT_MS 60s vs addLead seriale" non ha un bullet in `### Success Criteria:` (solo Performance/Developer Context). | Aggiungere bullet `#### Manual Verification:` in Phase 6 (o 3): "Run `send` con `count: 5` e confermare che il tool ritorna entro 60s con nessuna `campaign_send` parziale 'Queued'" e/o un guarda `cap()`-vs-timeout. | applied: bullet Manual in Phase 6 (coverage B) |
| code     | Phase 5 §1 (index.ts) | extensions/crm-a-ai-gateway/sync-trigger.ts:88 | suggestion | codebase-fit | `resolveWebBaseUrl`/`resolveStateDir`/`resolvePortFromProcessFile` re-implementano la logic già in `sync-trigger.ts`. | Estrarre in `extensions/shared/` e importare da entrambe le estensioni per evitare drift. | deferred: duplicazione accettabile per estensione self-contained; il refactor tocca anche crm-a-ai-gateway (fuori scope) — follow-up |
