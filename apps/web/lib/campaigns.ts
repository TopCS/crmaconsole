import { duckdbExecOnFileAsync, duckdbPathAsync, duckdbQueryAsync } from "./workspace";
import { loadCrmFieldMaps, sqlString } from "./crm-queries";
import { listSegmentMembers, type SegmentDefinition } from "./segments";
import { readConnections } from "./crm-a-console-state";
import { executeComposioTool, resolveToolSlug } from "./composio-execute";

/**
 * Campaign engine (CDP email marketing): resolves a campaign's segment into
 * an emailable audience and sends through the connected Gmail account
 * (Composio, via the Crm-A Cloud gateway). Sending is only possible when a
 * Gmail connection exists — there's no other transport.
 */

export type CampaignRow = {
  entry_id: string;
  Name: string | null;
  Subject: string | null;
  Body: string | null;
  Segment: string | null;
  Status: string | null;
  "Scheduled At": string | null;
  "Sent At": string | null;
  "Recipients Count": string | null;
};

export async function loadCampaign(entryId: string): Promise<CampaignRow | null> {
  const rows = await duckdbQueryAsync<CampaignRow>(
    `SELECT * FROM v_campaign WHERE entry_id = ${sqlString(entryId)} LIMIT 1;`,
  );
  return rows[0] ?? null;
}

export type AudienceMember = { entry_id: string; name: string | null; email: string };

/** Resolve a segment into the emailable audience (must have an email; skip
 * anonymous shadows — they can't receive email by definition). */
export async function resolveAudience(segmentEntryId: string): Promise<AudienceMember[]> {
  const rows = await duckdbQueryAsync<{ filter: string | null }>(
    `SELECT v."Filter" AS filter FROM v_segment v WHERE v.entry_id = ${sqlString(segmentEntryId)} LIMIT 1;`,
  );
  if (rows.length === 0) {
    throw new Error("Segment not found.");
  }
  let def: SegmentDefinition = {};
  if (rows[0].filter) {
    def = JSON.parse(rows[0].filter) as SegmentDefinition;
  }
  const { members } = await listSegmentMembers(def, { limit: 2000 });
  return members
    .filter((m) => m.email && m.email.trim() !== "" && m.source !== "Anonymous")
    .map((m) => ({ entry_id: m.entry_id, name: m.name, email: m.email as string }));
}

async function updateCampaignFields(
  entryId: string,
  values: Array<[string, string]>,
): Promise<void> {
  const dbPath = await duckdbPathAsync();
  if (!dbPath) {return;}
  const fieldMaps = await loadCrmFieldMaps();
  const statements: string[] = [];
  for (const [fieldName, value] of values) {
    const fieldId = fieldMaps.campaign[fieldName];
    if (!fieldId) {continue;}
    statements.push(
      `DELETE FROM entry_fields WHERE entry_id = ${sqlString(entryId)} AND field_id = ${sqlString(fieldId)};`,
      `INSERT INTO entry_fields (entry_id, field_id, value) VALUES (${sqlString(entryId)}, ${sqlString(fieldId)}, ${sqlString(value)});`,
    );
  }
  if (statements.length > 0) {
    await duckdbExecOnFileAsync(dbPath, statements.join("\n"));
  }
}

export type SendCampaignResult = {
  sent: number;
  failed: number;
  failures: Array<{ email: string; error: string }>;
};

export async function sendCampaign(entryId: string): Promise<SendCampaignResult> {
  const campaign = await loadCampaign(entryId);
  if (!campaign) {
    throw new Error("Campaign not found.");
  }
  if (!campaign.Segment) {
    throw new Error("Campaign has no segment selected.");
  }
  if (!campaign.Subject?.trim()) {
    throw new Error("Campaign has no subject.");
  }
  if (!campaign.Body?.trim()) {
    throw new Error("Campaign has no body.");
  }

  const connections = readConnections();
  const connectionId = connections.gmail?.connectionId;
  if (!connectionId) {
    throw new Error(
      "No Gmail connection. Connect Gmail (requires Crm-A Cloud) before sending campaigns.",
    );
  }

  const audience = await resolveAudience(campaign.Segment);
  const toolSlug = await resolveToolSlug({
    toolkitSlug: "gmail",
    preferredSlugs: ["GMAIL_SEND_EMAIL"],
  });

  let sent = 0;
  const failures: Array<{ email: string; error: string }> = [];
  // Serial sends — keeps us well under Gmail rate limits and makes failures
  // trivially attributable. Fine for MVP audience sizes.
  for (const member of audience) {
    try {
      await executeComposioTool({
        toolSlug,
        connectedAccountId: connectionId,
        arguments: {
          recipient_email: member.email,
          subject: campaign.Subject,
          body: campaign.Body,
        },
        maxRetries: 0,
      });
      sent += 1;
    } catch (err) {
      failures.push({
        email: member.email,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  await updateCampaignFields(entryId, [
    ["Status", "Sent"],
    ["Sent At", new Date().toISOString()],
    ["Recipients Count", String(sent)],
  ]);

  return { sent, failed: failures.length, failures };
}
