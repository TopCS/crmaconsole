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
  createVoicePearl,
} from "./nlpearl";
import { readPhoneWebhookSecret } from "./phone-webhook";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
      ${map["Nlpearl Phone ID"] ? `MAX(CASE WHEN ef.field_id = '${map["Nlpearl Phone ID"]}' THEN ef.value END) AS phoneId` : "NULL AS phoneId"},
      ${map["Calling Window Start"] ? `MAX(CASE WHEN ef.field_id = '${map["Calling Window Start"]}' THEN ef.value END) AS windowStart` : "NULL AS windowStart"},
      ${map["Calling Window End"] ? `MAX(CASE WHEN ef.field_id = '${map["Calling Window End"]}' THEN ef.value END) AS windowEnd` : "NULL AS windowEnd"},
      ${map["Calling Timezone"] ? `MAX(CASE WHEN ef.field_id = '${map["Calling Timezone"]}' THEN ef.value END) AS timezone` : "NULL AS timezone"},
      ${map["Calling Days"] ? `MAX(CASE WHEN ef.field_id = '${map["Calling Days"]}' THEN ef.value END) AS daysRaw` : "NULL AS daysRaw"},
      ${map["Max Attempts"] ? `MAX(CASE WHEN ef.field_id = '${map["Max Attempts"]}' THEN ef.value END) AS maxAttempts` : "NULL AS maxAttempts"},
      ${map["Nlpearl Retry Rate"] ? `MAX(CASE WHEN ef.field_id = '${map["Nlpearl Retry Rate"]}' THEN ef.value END) AS retryRate` : "NULL AS retryRate"},
      ${map["Nlpearl Agent Count"] ? `MAX(CASE WHEN ef.field_id = '${map["Nlpearl Agent Count"]}' THEN ef.value END) AS agentCount` : "NULL AS agentCount"}
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
    phoneId: r.phoneId ?? "",
    windowStart: r.windowStart ?? null,
    windowEnd: r.windowEnd ?? null,
    timezone: r.timezone ?? null,
    days,
    maxAttempts: r.maxAttempts ? Number(r.maxAttempts) : 3,
    retryRate: r.retryRate ? Number(r.retryRate) : 1,
    agentCount: r.agentCount ? Number(r.agentCount) : 5,
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
  brief?: string,
): Promise<string> {
  const cfg = await loadCampaignPhoneConfig(campaignId);
  if (!cfg) {throw new Error("Campaign not found.");}
  if (!cfg.phoneId) {throw new Error("Campaign missing Nlpearl Phone ID.");}
  if (!isNlpearlConfigured()) {throw new Error("NLPearl not configured.");}
  if (cfg.pearlId) {return cfg.pearlId;}

  const voiceId = await resolveVoiceId();
  if (!voiceId) {throw new Error("No NLPearl voice configured. Set NLPEARL_VOICE_ID or provision a voice.");}

  const days = cfg.days ?? [1, 2, 3, 4, 5];
  const start = cfg.windowStart ?? "09:00";
  const end = cfg.windowEnd ?? "18:00";
  const token = readPhoneWebhookSecret() ?? undefined;
  const urls = buildNlpearlCallbackUrls(requestOrigin, token);

  const payload = {
    name: `Campaign ${campaignId.slice(0, 8)}`,
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
          instructions: brief ? `Contenuto offerta da comunicare:\n${brief.trim().slice(0, 8000)}` : undefined,
          transitions: [{ name: "end", toNodeId: "end" }] },
        { nodeId: "end", name: "Fine", nodeType: 100,
          transitions: [] },
      ],
    },
    variables: [{ id: "customerNote", name: "Nota", group: 2 }],
    outbound: {
      phoneNumberId: cfg.phoneId,
      totalAgents: cfg.agentCount,
      maximumCallAttempts: Math.min(cfg.maxAttempts, 5),
      minimumRetryIntervalHours: cfg.retryRate,
      callingHours: days.map((day) => ({ day, start, end })),
      timeZone: windowsTimeZone(cfg.timezone),
      callWebhookUrl: urls.callWebhookUrl,
      leadWebhookUrl: urls.leadWebhookUrl,
    },
  };

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
export async function enqueuePhoneCampaign(campaignId: string): Promise<PhoneCampaignEnqueueResult> {
  const cfg = await loadCampaignPhoneConfig(campaignId);
  if (!cfg) {throw new Error("Campaign not found.");}
  if (!cfg.pearlId) {throw new Error("Campaign has no NLPearl Pearl ID — run createPhonePearlForCampaign first.");}
  if (!isNlpearlConfigured()) {throw new Error("NLPearl not configured.");}

  const dbPath = await duckdbPathAsync();
  if (!dbPath) {throw new Error("DuckDB not found.");}
  const fieldMaps = await loadCrmFieldMaps();

  // Only contacts who chose phone (Preferred Contact Channel = "phone")
  const audience = await resolveAudienceForCampaign();
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
        pearlId: cfg.pearlId,
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

/** Return phone-preference contacts with a phone number and marketing opt-in. */
async function resolveAudienceForCampaign(): Promise<Array<{ entry_id: string; name: string | null; email: string | null; phone: string | null }>> {
  const fieldMaps = await loadCrmFieldMaps();
  const phoneFld = fieldMaps.people["Phone Number"];
  const nameFld = fieldMaps.people["Full Name"];
  const emailFld = fieldMaps.people["Email Address"];
  const optinFld = fieldMaps.people["Marketing Opt-in"];
  const prefFld = fieldMaps.people["Preferred Contact Channel"];
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
      ${prefFld ? `AND EXISTS (SELECT 1 FROM entry_fields p WHERE p.entry_id = e.id AND p.field_id = '${prefFld}' AND p.value = 'phone')` : ""}
    GROUP BY e.id
    HAVING MAX(CASE WHEN ef.field_id = '${phoneFld}' THEN ef.value END) IS NOT NULL AND MAX(CASE WHEN ef.field_id = '${phoneFld}' THEN ef.value END) != ''
    LIMIT 500;`;
  const rows = await duckdbQueryAsync<{ entry_id: string; name: string | null; email: string | null; phone: string | null }>(sql);
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
