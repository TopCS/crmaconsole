/**
 * Campaign-phone transport (NLPearl outbound integration — Fase C).
 *
 * Builds on the existing `campaign` object extended with phone fields
 * (Nlpearl Pearl ID, caller, calling window, retry, concurrency) and
 * `campaign_send` rows extended with `External ID` (NLPearl Lead ID).
 * Only the phone path uses NLPearl; email campaigns continue to use SES.
 */

import { randomUUID } from "node:crypto";
import { duckdbExecOnFileAsync, duckdbPathAsync, duckdbQueryAsync } from "./workspace";
import { loadCrmFieldMaps, sqlString } from "./crm-queries";
import { ONBOARDING_OBJECT_IDS } from "./workspace-schema-migrations";
import { readNlpearlAuth, buildNlpearlCallbackUrls, addLead, setPearlActive } from "./nlpearl";
import { isNlpearlConfigured } from "./nlpearl";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CampaignPhoneConfig = {
  pearlId: string | null;
  callerPhone: string;
  windowStart: string | null;  // "09:00"
  windowEnd: string | null;    // "18:00"
  timezone: string | null;     // "Europe/Rome"
  days: number[] | null;       // [1,2,3,4,5]
  maxAttempts: number;         // ≤5
  retryHrs: number;            // 6
  concurrent: number;          // ≤10?
};

// ---------------------------------------------------------------------------
// Read phone config from campaign fields
// ---------------------------------------------------------------------------

async function loadCampaignPhoneConfig(campaignId: string): Promise<CampaignPhoneConfig | null> {
  const fieldMaps = await loadCrmFieldMaps();
  const map = fieldMaps.campaign;
  const sql = `
    SELECT
      e.id,
      ${map["Nlpearl Pearl ID"] ? `MAX(CASE WHEN ef.field_id = '${map["Nlpearl Pearl ID"]}' THEN ef.value END) AS pearlId` : "NULL AS pearlId"},
      ${map["Caller Phone Number"] ? `MAX(CASE WHEN ef.field_id = '${map["Caller Phone Number"]}' THEN ef.value END) AS callerPhone` : "NULL AS callerPhone"},
      ${map["Calling Window Start"] ? `MAX(CASE WHEN ef.field_id = '${map["Calling Window Start"]}' THEN ef.value END) AS windowStart` : "NULL AS windowStart"},
      ${map["Calling Window End"] ? `MAX(CASE WHEN ef.field_id = '${map["Calling Window End"]}' THEN ef.value END) AS windowEnd` : "NULL AS windowEnd"},
      ${map["Calling Timezone"] ? `MAX(CASE WHEN ef.field_id = '${map["Calling Timezone"]}' THEN ef.value END) AS timezone` : "NULL AS timezone"},
      ${map["Calling Days"] ? `MAX(CASE WHEN ef.field_id = '${map["Calling Days"]}' THEN ef.value END) AS daysRaw` : "NULL AS daysRaw"},
      ${map["Max Attempts"] ? `MAX(CASE WHEN ef.field_id = '${map["Max Attempts"]}' THEN ef.value END) AS maxAttempts` : "NULL AS maxAttempts"},
      ${map["Retry Interval Hours"] ? `MAX(CASE WHEN ef.field_id = '${map["Retry Interval Hours"]}' THEN ef.value END) AS retryHrs` : "NULL AS retryHrs"},
      ${map["Concurrent Calls"] ? `MAX(CASE WHEN ef.field_id = '${map["Concurrent Calls"]}' THEN ef.value END) AS concurrent` : "NULL AS concurrent"}
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
      days = r.daysRaw.split(",").map(Number).filter((v) => !Number.isNaN(v));
    }
  }

  return {
    pearlId: r.pearlId ?? null,
    callerPhone: r.callerPhone ?? "",
    windowStart: r.windowStart ?? null,
    windowEnd: r.windowEnd ?? null,
    timezone: r.timezone ?? null,
    days,
    maxAttempts: r.maxAttempts ? Number(r.maxAttempts) : 3,
    retryHrs: r.retryHrs ? Number(r.retryHrs) : 6,
    concurrent: r.concurrent ? Number(r.concurrent) : 5,
  };
}

export type PhoneCampaignEnqueueResult = {
  pearlId: string;
  leadsCreated: number;
  errors: string[];
};

/**
 * Create/update the NLPearl Outbound Pearl for this campaign (idempotent:
 * if the campaign already has a Pearl ID, re-using it). Returns the Pearl ID.
 */
export async function createPhonePearlForCampaign(
  campaignId: string,
  requestOrigin: string,
): Promise<string> {
  const cfg = await loadCampaignPhoneConfig(campaignId);
  if (!cfg) {throw new Error("Campaign not found.");}
  if (!cfg.callerPhone) {throw new Error("Campaign missing Caller Phone Number.");}
  if (!isNlpearlConfigured()) {throw new Error("NLPearl not configured.");}

  // Reuse existing Pearl if already created
  if (cfg.pearlId) {return cfg.pearlId;}

  const auth = readNlpearlAuth()!;
  const token = process.env.NLPEARL_PHONE_WEBHOOK_SECRET || process.env.CRM_A_PHONE_WEBHOOK_SECRET || "";
  const urls = buildNlpearlCallbackUrls(requestOrigin, token || undefined);

  // Minimal Pearl: single agent, simple flow. The campaign subject/body
  // becomes the OpeningSentence; the brief MD provides KB content (Fase D).
  const pearlRes = await fetch("https://api.nlpearl.ai/v2/Pearl/Voice", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${auth.accountId}:${auth.secretKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: `Campaign ${campaignId.slice(0, 8)}`,
      pearl: {
        companyName: "Crm-A",
        agentPersonality: "Professional and warm",
        modelType: 3,
        agents: [{ name: "Agent", voiceId: "default", language: "it-IT", gender: "female" }],
        nodes: [
          // Simple flow: opening → 1 dialogue → end + post-call webhook
          { nodeId: "open", name: "Saluto", nodeType: 2, script: "Buongiorno {firstName}, questa è una chiamata per conto di Crm-A Console.", transitions: [{ name: "ok", toNodeId: "speak" }] },
          { nodeId: "speak", name: "Offerta", nodeType: 10, script: "Vorremmo presentarle una nuova offerta.", transitions: [{ name: "end", toNodeId: "end" }] },
          { nodeId: "end", name: "Fine", nodeType: 100, script: "Grazie per il suo tempo.", transitions: [] },
        ],
        postCallActions: [],
      },
      outbound: {
        callerPhoneNumber: cfg.callerPhone,
        maxAttempts: Math.min(cfg.maxAttempts, 5),
        retryIntervalMinutes: cfg.retryHrs * 60,
        callingWindowStart: cfg.windowStart ?? "09:00",
        callingWindowEnd: cfg.windowEnd ?? "18:00",
        callingTimezone: cfg.timezone ?? "Europe/Rome",
        callingDays: cfg.days ?? [1, 2, 3, 4, 5],
        concurrentCallsLimit: cfg.concurrent,
        callWebhookUrl: urls.callWebhookUrl,
        leadWebhookUrl: urls.leadWebhookUrl,
      },
    }),
  });
  if (!pearlRes.ok) {
    const detail = await pearlRes.text().catch(() => "");
    throw new Error(`Failed to create NLPearl Pearl: ${pearlRes.status} ${detail}`);
  }
  const pearl = (await pearlRes.json()) as { id?: string; error?: string };
  if (!pearl.id) {throw new Error(`NLPearl Pearl creation returned no ID: ${pearl.error ?? "unknown"}`);}

  // Store Pearl ID back on the campaign
  const dbPath = await duckdbPathAsync();
  const fieldMaps = await loadCrmFieldMaps();
  const pearlFld = fieldMaps.campaign["Nlpearl Pearl ID"];
  if (dbPath && pearlFld) {
    await duckdbExecOnFileAsync(dbPath, [
      `DELETE FROM entry_fields WHERE entry_id = ${sqlString(campaignId)} AND field_id = ${sqlString(pearlFld)};`,
      `INSERT INTO entry_fields (entry_id, field_id, value) VALUES (${sqlString(campaignId)}, ${sqlString(pearlFld)}, ${sqlString(pearl.id)});`,
    ].join("\n"));
  }
  return pearl.id;
}

/**
 * Enqueue a campaign's segment audience as NLPearl leads and create
 * campaign_send rows tracking them (phone transport).
 */
export async function enqueuePhoneCampaign(campaignId: string): Promise<PhoneCampaignEnqueueResult> {
  const cfg = await loadCampaignPhoneConfig(campaignId);
  if (!cfg) {throw new Error("Campaign not found.");}
  if (!cfg.pearlId) {throw new Error("Campaign has no NLPearl Pearl ID — run createPhonePearlForCampaign first.");}
  if (!isNlpearlConfigured()) {throw new Error("NLPearl not configured.");}

  const dbPath = await duckdbPathAsync();
  if (!dbPath) {throw new Error("DuckDB not found.");}
  const fieldMaps = await loadCrmFieldMaps();

  const audience = await resolveAudienceForCampaign();
  const errors: string[] = [];
  let leadsCreated = 0;

  for (const member of audience) {
    const externalId = `crm-${campaignId.slice(0, 8)}-${member.entry_id.slice(0, 8)}`;
    try {
      await addLead({
        pearlId: cfg.pearlId,
        phoneNumber: member.phone ?? "",
        externalId,
        callData: { firstName: member.name ?? "Cliente", email: member.email },
      });
    } catch (err) {
      errors.push(`${member.entry_id}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    leadsCreated++;

    // Create campaign_send row with External ID
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
    ef("External ID", externalId);
    await duckdbExecOnFileAsync(dbPath, statements.join("\n"));
  }

  return { pearlId: cfg.pearlId, leadsCreated, errors };
}

/** Parse a raw phone value from the CRM (no normalization — raw store). */
async function resolveAudienceForCampaign(): Promise<Array<{ entry_id: string; name: string | null; email: string | null; phone: string | null }>> {
  const fieldMaps = await loadCrmFieldMaps();
  const phoneFld = fieldMaps.people["Phone Number"];
  const nameFld = fieldMaps.people["Full Name"];
  const emailFld = fieldMaps.people["Email Address"];
  const optinFld = fieldMaps.people["Marketing Opt-in"];
  if (!phoneFld) {return [];}
  const sql = `
    SELECT e.id AS entry_id,
      ${nameFld ? `MAX(CASE WHEN ef.field_id = '${nameFld}' THEN ef.value END)` : "NULL"} AS name,
      ${emailFld ? `MAX(CASE WHEN ef.field_id = '${emailFld}' THEN ef.value END)` : "NULL"} AS email,
      ${phoneFld ? `MAX(CASE WHEN ef.field_id = '${phoneFld}' THEN ef.value END)` : "NULL"} AS phone
    FROM entries e
    LEFT JOIN entry_fields ef ON ef.entry_id = e.id
    WHERE e.object_id = '${ONBOARDING_OBJECT_IDS.people}'
      ${optinFld ? `AND EXISTS (SELECT 1 FROM entry_fields o WHERE o.entry_id = e.id AND o.field_id = '${optinFld}' AND o.value = 'true')` : ""}
    GROUP BY e.id
    HAVING MAX(CASE WHEN ef.field_id = '${phoneFld}' THEN ef.value END) IS NOT NULL AND MAX(CASE WHEN ef.field_id = '${phoneFld}' THEN ef.value END) != ''
    LIMIT 500;`;
  const rows = await duckdbQueryAsync<{ entry_id: string; name: string | null; email: string | null; phone: string | null }>(sql);
  return rows;
}
/** Pause or resume the Pearl's outbound activity. */
export async function setCampaignPearlPaused(campaignId: string, paused: boolean): Promise<void> {
  const cfg = await loadCampaignPhoneConfig(campaignId);
  if (!cfg?.pearlId) {return;}
  await setPearlActive(cfg.pearlId, !paused);
}
