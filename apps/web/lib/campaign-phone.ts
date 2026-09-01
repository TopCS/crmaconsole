/**
 * Campaign-phone transport (NLPearl outbound integration — Fase C).
 *
 * Builds on the existing `campaign` object extended with phone fields
 * (Nlpearl Pearl ID, Phone ID, calling window, retry, agent count) and
 * `campaign_send` rows extended with `External ID` (NLPearl Lead ID).
 * Only the phone path uses NLPearl; email campaigns continue to use SES.
 *
 * Key contract: campaign_send is created BEFORE addLead so the send row's
 * UUID is the externalId; lead webhook callbacks can then resolve the row
 * and update its status.
 */

import { randomUUID } from "node:crypto";
import { duckdbExecOnFileAsync, duckdbPathAsync, duckdbQueryAsync } from "./workspace";
import { loadCrmFieldMaps, sqlString } from "./crm-queries";
import { ONBOARDING_OBJECT_IDS } from "./workspace-schema-migrations";
import {
  isNlpearlConfigured,
  buildNlpearlCallbackUrls,
  resolveVoiceId,
  addLead,
  setPearlActive,
  deleteNlpearlLeadsByExternal,
  getPearl,
  createVoicePearl,
} from "./nlpearl";
import { readPhoneWebhookSecret } from "./phone-webhook";
import { listSegmentMembers, type SegmentDefinition } from "./segments";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CampaignPhoneConfig = {
  pearlId: string | null;
  phoneId: string;
  name: string | null;
  segmentId: string | null;
  windowStart: string | null;
  windowEnd: string | null;
  timezone: string | null;
  days: number[] | null;
  maxAttempts: number;
  retryRate: number;
  agentCount: number;
  brief: string | null;
};

// ---------------------------------------------------------------------------
// Read phone config from campaign fields
// ---------------------------------------------------------------------------

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
      ${map["Name"] ? `MAX(CASE WHEN ef.field_id = '${map["Name"]}' THEN ef.value END) AS name` : "NULL AS name"},
      ${map["Segment"] ? `MAX(CASE WHEN ef.field_id = '${map["Segment"]}' THEN ef.value END) AS segmentId` : "NULL AS segmentId"},
      ${map["Voice Brief"] ? `MAX(CASE WHEN ef.field_id = '${map["Voice Brief"]}' THEN ef.value END) AS brief` : "NULL AS brief"}
    FROM entries e
    LEFT JOIN entry_fields ef ON ef.entry_id = e.id
    WHERE e.object_id = '${ONBOARDING_OBJECT_IDS.campaign}' AND e.id = ${sqlString(campaignId)}
    GROUP BY e.id LIMIT 1;`;
  const rows = await duckdbQueryAsync<Record<string, string | null>>(sql);
  const r = rows[0];
  if (!r) {return null;}
  let days: number[] | null = null;
  if (r.daysRaw) {
    try {
      const parsed = JSON.parse(r.daysRaw);
      if (Array.isArray(parsed)) {days = parsed.filter((v) => typeof v === "number");}
    } catch {
      // Human formats the agent may write: "1-5" (range) or "1,2,3".
      const range = /^(\d+)\s*-\s*(\d+)$/.exec(r.daysRaw.trim());
      if (range) {
        const lo = Number(range[1]);
        const hi = Number(range[2]);
        days = hi >= lo && hi - lo < 20
          ? Array.from({ length: hi - lo + 1 }, (_, i) => lo + i)
          : [];
      } else {
        days = r.daysRaw.split(",").map(Number).filter((v) => !Number.isNaN(v));
      }
    }
    if (days && days.length === 0) {days = null;}
  }
  return {
    pearlId: r.pearlId ?? null,
    phoneId: r.phoneId ?? "",
    name: r.name ?? null,
    segmentId: r.segmentId ?? null,
    windowStart: r.windowStart ?? null,
    windowEnd: r.windowEnd ?? null,
    timezone: r.timezone ?? null,
    days,
    maxAttempts: r.maxAttempts ? Number(r.maxAttempts) : 3,
    retryRate: r.retryRate ? Number(r.retryRate) : 1,
    // Default: UN agent (ogni agente genera costi). Di più via comando: upsert agentCount.
    agentCount: r.agentCount ? Number(r.agentCount) : 1,
    brief: r.brief ?? null,
  };
}

// ---------------------------------------------------------------------------
// Upsert campaign card (create/update) for the phone path
// ---------------------------------------------------------------------------

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
  /** Segment NAME spoken by the operator (e.g. "Lancio Samsung Galaxy") —
   * resolved to the segment entry id and linked on the campaign card. */
  segmentName?: string;
};

/** Resolve a segment by its Name field → segment entry id (null when absent). */
export async function resolveSegmentIdByName(name: string): Promise<string | null> {
  const dbPath = await duckdbPathAsync();
  const fieldMaps = await loadCrmFieldMaps();
  const nameFld = fieldMaps.segment["Name"];
  if (!dbPath || !nameFld) {return null;}
  const rows = await duckdbQueryAsync<{ entry_id: string }>(
    `SELECT ef.entry_id FROM entries e
     JOIN entry_fields ef ON ef.entry_id = e.id
     WHERE e.object_id = '${ONBOARDING_OBJECT_IDS.segment}'
       AND ef.field_id = ${sqlString(nameFld)}
       AND LOWER(ef.value) = ${sqlString(name.toLowerCase())}
     LIMIT 1;`,
  );
  return rows[0]?.entry_id ?? null;
}

/**
 * Create/update a campaign card + its phone config (insert-or-ignore the
 * entry, then delete+reinsert the phone/voice fields). Returns the campaignId
 * (a fresh UUID if input.campaignId was omitted).
 */
export async function upsertPhoneCampaign(input: PhoneCampaignUpsertInput): Promise<string> {
  const dbPath = await duckdbPathAsync();
  if (!dbPath) {throw new Error("DuckDB not found.");}
  const fieldMaps = await loadCrmFieldMaps();
  const campaignId = input.campaignId?.trim() ? input.campaignId.trim() : randomUUID();
  const now = new Date().toISOString();
  const statements: string[] = [
    `INSERT OR IGNORE INTO entries (id, object_id, created_at, updated_at) VALUES (${sqlString(campaignId)}, ${sqlString(ONBOARDING_OBJECT_IDS.campaign)}, ${sqlString(now)}, ${sqlString(now)});`,
  ];
  const writeField = (name: string, value: string | number | null | undefined) => {
    const fieldId = fieldMaps.campaign[name];
    if (!fieldId || value === undefined || value === null || value === "") {return;}
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
  writeField("Voice Brief", input.brief);
  const segmentId = input.segmentName?.trim()
    ? await resolveSegmentIdByName(input.segmentName.trim())
    : undefined;
  if (input.segmentName?.trim() && !segmentId) {
    throw new Error(`Segment "${input.segmentName.trim()}" not found — create it first or check the name.`);
  }
  writeField("Segment", segmentId);
  writeField("Voice Brief", input.brief);
  statements.push(`UPDATE entries SET updated_at = ${sqlString(now)} WHERE id = ${sqlString(campaignId)};`);
  await duckdbExecOnFileAsync(dbPath, statements.join("\n"));
  return campaignId;
}

export type PhoneCampaignEnqueueResult = {
  pearlId: string;
  leadsCreated: number;
  errors: string[];
};

/**
 * NLPearl caps node `instructions` at 250 characters. The operator's Voice
 * Brief is usually longer, so condense it into the budget: whole sentences
 * when possible, hard cut + ellipsis otherwise. The full brief stays on the
 * campaign card (Body field); only what the Pearl node can hold shrinks.
 */
export const NLPEARL_MAX_INSTRUCTION_CHARS = 250;
const OFFER_INSTRUCTION_PREFIX = "Offerta da comunicare:\n";

export function buildOfferInstruction(briefContent: string): string {
  const text = briefContent.trim();
  if (text.length + OFFER_INSTRUCTION_PREFIX.length <= NLPEARL_MAX_INSTRUCTION_CHARS) {
    return OFFER_INSTRUCTION_PREFIX + text;
  }
  const budget = NLPEARL_MAX_INSTRUCTION_CHARS - OFFER_INSTRUCTION_PREFIX.length;
  const cut = text.slice(0, budget);
  const lastStop = Math.max(
    cut.lastIndexOf(". "),
    cut.lastIndexOf(".\n"),
    cut.lastIndexOf("! "),
    cut.lastIndexOf("? "),
    cut.lastIndexOf("; "),
  );
  if (lastStop > budget / 2) {
    return OFFER_INSTRUCTION_PREFIX + cut.slice(0, lastStop + 1);
  }
  return OFFER_INSTRUCTION_PREFIX + cut.slice(0, budget - 1).trimEnd() + "…";
}
/**
 * Create/update the NLPearl Outbound Pearl for this campaign (idempotent:
 * if the campaign already has a Pearl ID, re-using it). Returns the Pearl ID.
 */
export async function createPhonePearlForCampaign(
  campaignId: string,
  requestOrigin: string,
  brief?: string,
): Promise<string> {
  const cfg = await loadCampaignPhoneConfig(campaignId);
  if (!cfg) {throw new Error("Campaign not found.");}
  if (!cfg.phoneId) {throw new Error("Campaign missing Nlpearl Phone ID.");}
  if (cfg.pearlId) {
    // The stored Pearl ID can be stale (the Pearl may have been deleted from
    // the NLPearl dashboard out-of-band): validate before reusing, else the
    // send would target a dead Pearl forever.
    const existing = await getPearl(cfg.pearlId);
    if (existing) {return cfg.pearlId;}
  }

  const voiceId = await resolveVoiceId();
  if (!voiceId) {throw new Error("No NLPearl voice configured. Set NLPEARL_VOICE_ID or provision a voice.");}

  // An empty parsed days array is NOT a valid fallback — treat it as unset.
  const days = cfg.days && cfg.days.length > 0 ? cfg.days : [1, 2, 3, 4, 5];
  const start = cfg.windowStart ?? "09:00";
  const end = cfg.windowEnd ?? "18:00";
  const briefContent = brief ?? cfg.brief ?? undefined;
  const token = readPhoneWebhookSecret() ?? undefined;
  const urls = buildNlpearlCallbackUrls(requestOrigin, token);

  const payload = {
    // Name the Pearl after the campaign so it's recognizable on NLPearl.
    name: cfg.name ?? `Campaign ${campaignId.slice(0, 8)}`,
    pearl: {
      companyName: "Crm-A",
      companyDescription: "Campagna chiamante gestita da Crm-A Console.",
      agentPersonality: "Professional and warm",
      modelType: 3,
      agents: [{ name: "Agent", voiceId }],
      timeZone: windowsTimeZone(cfg.timezone),
      nodes: [
        { nodeId: "open", name: "Saluto", nodeType: 2,
          script: "Buongiorno {firstName}, una chiamata per conto di Crm-A Console.",
          transitions: [{ name: "ok", toNodeId: "speak" }] },
        { nodeId: "speak", name: "Offerta", nodeType: 10,
          script: "Vorremmo presentarle una nuova offerta.",
          instructions: briefContent ? buildOfferInstruction(briefContent) : undefined,
          transitions: [{ name: "end", toNodeId: "end" }] },
        { nodeId: "end", name: "Fine", nodeType: 100,
          transitions: [] },
      ],
    },
    variables: [{ id: "customerNote", name: "Nota", group: 2 }],
    outbound: {
      phoneNumberId: cfg.phoneId,
      totalAgents: cfg.agentCount ?? 1,
      maximumCallAttempts: Math.min(cfg.maxAttempts, 5),
      minimumRetryIntervalHours: retryIntervalEnum(cfg.retryRate),
      callingHours: days.map((day) => ({ day, start, end })),
      timeZone: windowsTimeZone(cfg.timezone),
      callWebhookUrl: urls.callWebhookUrl,
      leadWebhookUrl: urls.leadWebhookUrl,
    },
  };

  // Observability: NLPearl's validation errors are opaque ("Invalid Webhook
  // URL") without the exact payload. Redact the webhook token before logging.
  const redactToken = (_key: string, value: unknown) =>
    typeof value === "string" ? value.replace(/token=[^&"\\]+/g, "token=[redacted]") : value;
  console.log(`[nlpearl] Pearl/Voice create payload: ${JSON.stringify(payload, redactToken)}`);
  const pearlId = await createVoicePearl(payload as unknown as Record<string, unknown>);


  const dbPath = await duckdbPathAsync();
  const fieldMaps = await loadCrmFieldMaps();
  const pearlFld = fieldMaps.campaign["Nlpearl Pearl ID"];
  if (dbPath && pearlFld) {
    await duckdbExecOnFileAsync(dbPath, [
      `DELETE FROM entry_fields WHERE entry_id = ${sqlString(campaignId)} AND field_id = ${sqlString(pearlFld)};`,
      `INSERT INTO entry_fields (entry_id, field_id, value) VALUES (${sqlString(campaignId)}, ${sqlString(pearlFld)}, ${sqlString(pearlId)});`,
    ].join("\n"));
  }
  return pearlId;
}

/** Retry interval → NLPearl enum (contract: 1=Every6Hours, 2=OnceADay,
 * 3=OnceEvery3Days, 4=OnceAWeek, 5=OnceAMonth, 6=Every3Hours). The campaign
 * stores raw hours; unset defaults to OnceADay (the previous 24h default). */
function retryIntervalEnum(hours: number | null | undefined): number {
  if (hours == null) {return 2;}
  if (hours >= 720) {return 5;}
  if (hours >= 168) {return 4;}
  if (hours >= 72) {return 3;}
  if (hours >= 24) {return 2;}
  if (hours >= 6) {return 1;}
  return 6;
}

/** IANA → Windows time-zone mapping (demo subset). */
function windowsTimeZone(iana: string | null): string {
  const map: Record<string, string> = {
    "Europe/Rome": "Romance Standard Time",
    "Europe/Paris": "Romance Standard Time",
    "Europe/Berlin": "W. Europe Standard Time",
    "Europe/London": "GMT Standard Time",
    "America/New_York": "Eastern Standard Time",
  };
  return map[iana ?? ""] ?? "Romance Standard Time";
}

/**
 * Enqueue a campaign's phone-preference audience as NLPearl leads.
 * campaign_send rows are created BEFORE addLead so the UUID is the externalId,
 * enabling lead webhook callbacks to update Status.
 */
export async function enqueuePhoneCampaign(
  campaignId: string,
  criteria?: PhoneAudienceCriteria,
  requestOrigin?: string,
): Promise<PhoneCampaignEnqueueResult> {
  let cfg = await loadCampaignPhoneConfig(campaignId);
  if (!cfg) {throw new Error("Campaign not found.");}
  // The Pearl is a prerequisite of the lead enqueue: auto-create it (paused)
  // when the campaign card doesn't have one yet, so "send" is always enough.
  if (!cfg.pearlId) {
    if (!requestOrigin) {throw new Error("Campaign has no NLPearl Pearl ID and no request origin to auto-create one.");}
    const pearlId = await createPhonePearlForCampaign(campaignId, requestOrigin);
    cfg = await loadCampaignPhoneConfig(campaignId) ?? cfg;
    void pearlId;
  }
  if (!cfg.pearlId) {throw new Error("Campaign has no NLPearl Pearl ID after auto-create.");}
  const dbPath = await duckdbPathAsync();
  if (!dbPath) {throw new Error("DuckDB not found.");}
  const fieldMaps = await loadCrmFieldMaps();

  const audience = await resolveAudienceForCampaign(campaignId, criteria);
  const errors: string[] = [];
  let leadsCreated = 0;

  for (const member of audience) {
    // Create campaign_send row FIRST — its UUID IS the externalId
    const sendId = randomUUID();
    const now = new Date().toISOString();
    const statements: string[] = [
      `INSERT INTO entries (id, object_id, created_at, updated_at) VALUES (${sqlString(sendId)}, ${sqlString(ONBOARDING_OBJECT_IDS.campaign_send)}, ${sqlString(now)}, ${sqlString(now)});`,
    ];
    const ef = (fld: string, val: string) => {
      const id = fieldMaps.campaign_send[fld];
      if (!id) {return;}
      statements.push(`INSERT INTO entry_fields (entry_id, field_id, value) VALUES (${sqlString(sendId)}, ${sqlString(id)}, ${sqlString(val)});`);
    };
    ef("Campaign", campaignId);
    ef("Person", member.entry_id);
    ef("Email", member.email ?? "");
    ef("Status", "Queued");
    ef("Attempts", "0");
    ef("External ID", sendId);
    await duckdbExecOnFileAsync(dbPath, statements.join("\n"));

    try {
      await addLead({
        pearlId: cfg.pearlId as string,
        phoneNumber: member.phone ?? "",
        externalId: sendId,
        callData: { firstName: member.name ?? "Cliente", email: member.email },
      });
      leadsCreated++;
    } catch (err) {
      errors.push(`${member.entry_id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { pearlId: cfg.pearlId, leadsCreated, errors };
}

// ---------------------------------------------------------------------------
// Audience resolution
// ---------------------------------------------------------------------------

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
    // Segment-scoped: base query senza LIMIT (condivisa), filtro in memoria + cap.
    const rows = await duckdbQueryAsync<{ entry_id: string; name: string | null; email: string | null; phone: string | null }>(`${baseSql};`);
    const members = await resolveSegmentMemberIds(segmentId);
    const scoped = rows.filter((r) => members.has(r.entry_id));
    return scoped.slice(0, cap(criteria));
  }
  // No-segment: il cap è spinto nel SQL per non caricare tutta la popolazione compliant.
  const limitedSql = `${baseSql} LIMIT ${cap(criteria)};`;
  const rows = await duckdbQueryAsync<{ entry_id: string; name: string | null; email: string | null; phone: string | null }>(limitedSql);
  return rows;
}

/** Look up a campaign_send row by its External ID and update the Status. */
export async function updateCampaignSendByExternalId(
  externalId: string,
  status: string,
): Promise<boolean> {
  const dbPath = await duckdbPathAsync();
  if (!dbPath) {return false;}
  const fieldMaps = await loadCrmFieldMaps();
  const extIdField = fieldMaps.campaign_send["External ID"];
  const statusField = fieldMaps.campaign_send["Status"];
  if (!extIdField || !statusField) {return false;}
  await duckdbExecOnFileAsync(dbPath, [
    `DELETE FROM entry_fields WHERE entry_id IN (SELECT entry_id FROM entry_fields WHERE field_id = ${sqlString(extIdField)} AND value = ${sqlString(externalId)}) AND field_id = ${sqlString(statusField)};`,
    `INSERT INTO entry_fields (entry_id, field_id, value) SELECT entry_id, ${sqlString(statusField)}, ${sqlString(status)} FROM entry_fields WHERE field_id = ${sqlString(extIdField)} AND value = ${sqlString(externalId)} LIMIT 1;`,
  ].join("\n"));
  return true;
}

/** Pause or resume the Pearl's outbound activity. */
export async function setCampaignPearlPaused(campaignId: string, paused: boolean): Promise<void> {
  const cfg = await loadCampaignPhoneConfig(campaignId);
  if (!cfg?.pearlId) {return;}
  await setPearlActive(cfg.pearlId, !paused);
}

/**
 * Best-effort NLPearl teardown when a linked campaign is deleted from the
 * CRM. NLPearl's API has no Pearl DELETE — the equivalent cleanup is:
 * pause the Pearl (nothing dials) and remove its queued leads (the ones we
 * enqueued, identified by their externalId = campaign_send entry id), so an
 * orphaned Pearl can never be activated into calling someone.
 */
export async function teardownPhoneCampaignPearl(campaignId: string): Promise<{
  pearlId: string | null;
  paused: boolean;
  leadsDeleted: boolean;
}> {
  const cfg = await loadCampaignPhoneConfig(campaignId);
  if (!cfg?.pearlId) {return { pearlId: null, paused: false, leadsDeleted: false };}
  const pearlId = cfg.pearlId;

  // The Pearl ID field on the card is about to disappear with the entry —
  // collect the send externalIds (send entry ids) BEFORE the campaign row
  // goes, while the link is still readable.
  const extField = (await loadCrmFieldMaps()).campaign_send["External ID"];
  const sendRows = extField
    ? await duckdbQueryAsync<{ entry_id: string }>(
        `SELECT DISTINCT ef.entry_id FROM entries e
         JOIN entry_fields ef ON ef.entry_id = e.id
         WHERE e.object_id = '${ONBOARDING_OBJECT_IDS.campaign_send}'
           AND ef.field_id = ${sqlString((await loadCrmFieldMaps()).campaign_send["Campaign"] ?? "")}
           AND ef.value = ${sqlString(campaignId)};`,
      )
    : [];
  const externalIds = sendRows.map((r) => r.entry_id).filter(Boolean);
  let paused = false;
  let leadsDeleted = false;
  try {
    await setPearlActive(pearlId, false);
    paused = true;
  } catch (err) {
    console.error(`[campaigns] Pearl ${pearlId} pause failed:`, err);
  }
  try {
    leadsDeleted = externalIds.length > 0
      ? await deleteNlpearlLeadsByExternal(pearlId, externalIds)
      : true;
  } catch (err) {
    console.error(`[campaigns] Pearl ${pearlId} lead delete failed:`, err);
  }
  return { pearlId, paused, leadsDeleted };
}
