import { randomUUID } from "node:crypto";
import { duckdbExecOnFileAsync, duckdbPathAsync, duckdbQueryAsync } from "./workspace";
import { loadCrmFieldMaps, sqlString } from "./crm-queries";
import { listSegmentMembers, type SegmentDefinition } from "./segments";
import { sendSesEmail } from "./ses";
import { normalizePhone } from "./events";
import { deliverToSession } from "./openclaw-send";
import { ONBOARDING_OBJECT_IDS } from "./workspace-schema-migrations";

/**
 * Campaign engine (CDP email marketing via AWS SES).
 *
 * Campaigns are async jobs with a per-recipient queue (`campaign_send`
 * object): "send" enqueues the audience and flips the campaign to Sending;
 * the worker (`campaign-worker.ts`, started from instrumentation.ts) drains
 * the queue in small batches. Lifecycle actions — pause/resume/cancel — act
 * on the campaign status and are honoured by the worker between batches.
 *
 * Bounce handling arrives via the SNS webhook
 * (`/api/crm/campaigns/ses-webhook`): permanent bounces and complaints mark
 * the recipient (and the person's `Email Status`, excluded from future
 * audiences); transient bounces are retried with exponential backoff.
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

export type CampaignStatus = "Draft" | "Sending" | "Paused" | "Sent" | "Cancelled";
export type SendStatus =
  | "Queued"
  | "Sent"
  | "Soft Bounced"
  | "Hard Bounced"
  | "Complained"
  | "Failed"
  | "Cancelled";

const SEND_BATCH_SIZE = 10;
const MAX_ATTEMPTS = 3;
/** Backoff between attempts: 1h, 6h, 24h. */
const RETRY_BACKOFF_MS = [3_600_000, 21_600_000, 86_400_000];

// ---------------------------------------------------------------------------
// Campaign row access
// ---------------------------------------------------------------------------

export async function loadCampaign(entryId: string): Promise<CampaignRow | null> {
  const rows = await duckdbQueryAsync<CampaignRow>(
    `SELECT * FROM v_campaign WHERE entry_id = ${sqlString(entryId)} LIMIT 1;`,
  );
  return rows[0] ?? null;
}

async function setEntryFieldValues(
  objectName: "campaign" | "campaign_send" | "people",
  entryId: string,
  values: Array<[string, string]>,
): Promise<void> {
  const dbPath = await duckdbPathAsync();
  if (!dbPath) {return;}
  const fieldMaps = await loadCrmFieldMaps();
  const statements: string[] = [];
  for (const [fieldName, value] of values) {
    const fieldId = fieldMaps[objectName][fieldName];
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

export async function setCampaignStatus(entryId: string, status: CampaignStatus): Promise<void> {
  await setEntryFieldValues("campaign", entryId, [["Status", status]]);
}

// ---------------------------------------------------------------------------
// Audience
// ---------------------------------------------------------------------------

export type AudienceMember = { entry_id: string; name: string | null; email: string };

/** Resolve a segment into the emailable audience: members with an email who
 * are not anonymous shadows and not suppressed (hard bounce / complaint /
 * unsubscribe). */
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
  const suppressed = new Set(["Hard Bounced", "Complained", "Unsubscribed"]);
  return members
    .filter(
      (m) =>
        m.email &&
        m.email.trim() !== "" &&
        m.source !== "Anonymous" &&
        !suppressed.has(m.email_status ?? ""),
    )
    .map((m) => ({ entry_id: m.entry_id, name: m.name, email: m.email as string }));
}

// ---------------------------------------------------------------------------
// Multichannel send (Atto 3): route each recipient by Preferred Contact
// Channel — email via SES, Telegram via the OpenClaw runtime. Additive to the
// SES queue above; does not rework campaign_send.
// ---------------------------------------------------------------------------

export type ChannelAudienceMember = AudienceMember & {
  preferredContact: string | null;
  phone: string | null;
};

/** Load per-member channel preference + phone from the people rows. */
async function hydrateAudienceChannels(
  members: AudienceMember[],
): Promise<ChannelAudienceMember[]> {
  if (members.length === 0) {return [];}
  const fieldMaps = await loadCrmFieldMaps();
  const prefFieldId = fieldMaps.people["Preferred Contact Channel"];
  const phoneFieldId = fieldMaps.people["Phone Number"];
  if (!prefFieldId && !phoneFieldId) {
    return members.map((m) => ({ ...m, preferredContact: null, phone: null }));
  }
  const inList = members.map((m) => `'${m.entry_id.replace(/'/g, "''")}'`).join(", ");
  const rows = await duckdbQueryAsync<{ person_id: string; pref: string | null; phone: string | null }>(
    `SELECT e.id AS person_id,
       ${prefFieldId ? `MAX(CASE WHEN ef.field_id = '${prefFieldId}' THEN ef.value END)` : "NULL"} AS pref,
       ${phoneFieldId ? `MAX(CASE WHEN ef.field_id = '${phoneFieldId}' THEN ef.value END)` : "NULL"} AS phone
       FROM entries e
       LEFT JOIN entry_fields ef ON ef.entry_id = e.id
      WHERE e.object_id = '${ONBOARDING_OBJECT_IDS.people}' AND e.id IN (${inList})
      GROUP BY e.id;`,
  );
  const byId = new Map(rows.map((r) => [r.person_id, r]));
  return members.map((m) => {
    const row = byId.get(m.entry_id);
    return {
      ...m,
      preferredContact: row?.pref ?? null,
      phone: row?.phone ?? null,
    };
  });
}

export type MultichannelSendResult = {
  sent: number;
  telegram: number;
  email: number;
  failed: string[];
};

/**
 * Send a launch message to a segment audience, routing by the recipient's
 * `Preferred Contact Channel` (default email). Telegram goes through the
 * OpenClaw runtime on the per-contact session (`phone:<e164>`); email via SES.
 * Non-fatal per-recipient errors are collected in `failed`.
 */
export async function sendCampaignMultichannel(params: {
  segmentEntryId: string;
  subject: string;
  body: string;
}): Promise<MultichannelSendResult> {
  const audience = await resolveAudience(params.segmentEntryId);
  const members = await hydrateAudienceChannels(audience);

  const result: MultichannelSendResult = { sent: 0, telegram: 0, email: 0, failed: [] };
  for (const m of members) {
    const useTelegram = m.preferredContact === "telegram";
    try {
      if (useTelegram) {
        const phone = normalizePhone(m.phone);
        if (!phone) {
          result.failed.push(`${m.entry_id}: telegram preferred but no phone`);
          continue;
        }
        const res = await deliverToSession({
          sessionKey: `phone:${phone}`,
          message: `${params.subject}\n\n${params.body}`,
        });
        if (!res.ok) {
          result.failed.push(`${m.entry_id}: ${res.error ?? "delivery failed"}`);
          continue;
        }
        result.telegram++;
      } else {
        await sendSesEmail({ to: m.email, subject: params.subject, body: params.body });
        result.email++;
      }
      result.sent++;
    } catch (err) {
      result.failed.push(`${m.entry_id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Lifecycle: enqueue / pause / resume / cancel
// ---------------------------------------------------------------------------

export async function enqueueCampaign(entryId: string): Promise<{ queued: number }> {
  const campaign = await loadCampaign(entryId);
  if (!campaign) {throw new Error("Campaign not found.");}
  if (campaign.Status && campaign.Status !== "Draft") {
    throw new Error(`Campaign is ${campaign.Status} — only Draft campaigns can be sent.`);
  }
  if (!campaign.Segment) {throw new Error("Campaign has no segment selected.");}
  if (!campaign.Subject?.trim()) {throw new Error("Campaign has no subject.");}
  if (!campaign.Body?.trim()) {throw new Error("Campaign has no body.");}

  const audience = await resolveAudience(campaign.Segment);
  const dbPath = await duckdbPathAsync();
  if (!dbPath) {throw new Error("No workspace database found.");}
  const fieldMaps = await loadCrmFieldMaps();
  const sendFields = fieldMaps.campaign_send;
  const now = new Date().toISOString();

  const statements: string[] = [];
  for (const member of audience) {
    const sendId = randomUUID();
    statements.push(
      `INSERT INTO entries (id, object_id, created_at, updated_at) VALUES (${sqlString(sendId)}, ${sqlString(ONBOARDING_OBJECT_IDS.campaign_send)}, ${sqlString(now)}, ${sqlString(now)});`,
    );
    const fields: Array<[string, string]> = [
      ["Campaign", entryId],
      ["Person", member.entry_id],
      ["Email", member.email],
      ["Status", "Queued"],
      ["Attempts", "0"],
    ];
    for (const [fieldName, value] of fields) {
      const fieldId = sendFields[fieldName];
      if (!fieldId) {continue;}
      statements.push(
        `INSERT INTO entry_fields (entry_id, field_id, value) VALUES (${sqlString(sendId)}, ${sqlString(fieldId)}, ${sqlString(value)});`,
      );
    }
  }
  if (statements.length > 0) {
    await duckdbExecOnFileAsync(dbPath, statements.join("\n"));
  }
  await setEntryFieldValues("campaign", entryId, [
    ["Status", "Sending"],
    ["Recipients Count", "0"],
  ]);
  return { queued: audience.length };
}

export async function pauseCampaign(entryId: string): Promise<void> {
  const campaign = await loadCampaign(entryId);
  if (!campaign) {throw new Error("Campaign not found.");}
  if (campaign.Status !== "Sending") {
    throw new Error("Only a Sending campaign can be paused.");
  }
  await setCampaignStatus(entryId, "Paused");
}

export async function resumeCampaign(entryId: string): Promise<void> {
  const campaign = await loadCampaign(entryId);
  if (!campaign) {throw new Error("Campaign not found.");}
  if (campaign.Status !== "Paused") {
    throw new Error("Only a Paused campaign can be resumed.");
  }
  await setCampaignStatus(entryId, "Sending");
}

export async function cancelCampaign(entryId: string): Promise<void> {
  const campaign = await loadCampaign(entryId);
  if (!campaign) {throw new Error("Campaign not found.");}
  if (campaign.Status !== "Sending" && campaign.Status !== "Paused") {
    throw new Error("Only a Sending or Paused campaign can be cancelled.");
  }
  // Drop everything still queued so the worker has nothing to pick up.
  await duckdbExecOnFileAsync(
    (await duckdbPathAsync()) ?? "",
    `UPDATE entry_fields SET value = 'Cancelled'
     WHERE field_id = ${sqlString((await loadCrmFieldMaps()).campaign_send["Status"])}
       AND value = 'Queued'
       AND entry_id IN (
         SELECT ef.entry_id FROM entry_fields ef
         WHERE ef.field_id = ${sqlString((await loadCrmFieldMaps()).campaign_send["Campaign"])}
           AND ef.value = ${sqlString(entryId)}
       );`,
  );
  await setCampaignStatus(entryId, "Cancelled");
}

/** Delete a campaign and its send-log rows. */
export async function deleteCampaign(entryId: string): Promise<void> {
  const dbPath = await duckdbPathAsync();
  if (!dbPath) {return;}
  const fieldMaps = await loadCrmFieldMaps();
  const campaignFieldId = fieldMaps.campaign_send["Campaign"];
  const sendIds = campaignFieldId
    ? await duckdbQueryAsync<{ entry_id: string }>(
        `SELECT entry_id FROM entry_fields WHERE field_id = ${sqlString(campaignFieldId)} AND value = ${sqlString(entryId)};`,
      )
    : [];
  const statements: string[] = [];
  for (const row of sendIds) {
    statements.push(`DELETE FROM entry_fields WHERE entry_id = ${sqlString(row.entry_id)};`);
    statements.push(`DELETE FROM entries WHERE id = ${sqlString(row.entry_id)};`);
  }
  statements.push(`DELETE FROM entry_fields WHERE entry_id = ${sqlString(entryId)};`);
  statements.push(`CHECKPOINT;`);
  statements.push(`DELETE FROM entries WHERE id = ${sqlString(entryId)};`);
  await duckdbExecOnFileAsync(dbPath, statements.join("\n"));
}

// ---------------------------------------------------------------------------
// Worker: drain the queue
// ---------------------------------------------------------------------------

type SendRow = {
  entry_id: string;
  campaign_id: string;
  email: string | null;
  attempts: string | null;
};

async function listSendingCampaignIds(): Promise<string[]> {
  const fieldMaps = await loadCrmFieldMaps();
  const statusFieldId = fieldMaps.campaign["Status"];
  if (!statusFieldId) {return [];}
  const rows = await duckdbQueryAsync<{ entry_id: string }>(
    `SELECT entry_id FROM entry_fields WHERE field_id = ${sqlString(statusFieldId)} AND value = 'Sending';`,
  );
  return rows.map((r) => r.entry_id);
}

async function listQueuedSends(campaignId: string, limit: number): Promise<SendRow[]> {
  return duckdbQueryAsync<SendRow>(
    `SELECT v.entry_id,
            v."Campaign" AS campaign_id,
            v."Email" AS email,
            v."Attempts" AS attempts
     FROM v_campaign_send v
     WHERE v."Campaign" = ${sqlString(campaignId)}
       AND v."Status" = 'Queued'
       AND (v."Next Attempt At" IS NULL OR v."Next Attempt At" <= ${sqlString(new Date().toISOString())})
     ORDER BY v.created_at ASC
     LIMIT ${limit};`,
  );
}

async function countSendsByStatus(campaignId: string, status: SendStatus): Promise<number> {
  const rows = await duckdbQueryAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM v_campaign_send v
     WHERE v."Campaign" = ${sqlString(campaignId)} AND v."Status" = ${sqlString(status)};`,
  );
  return Number(rows[0]?.n ?? 0);
}

export type CampaignStats = {
  queued: number;
  sent: number;
  softBounced: number;
  hardBounced: number;
  complained: number;
  failed: number;
  cancelled: number;
};

export async function campaignStats(campaignId: string): Promise<CampaignStats> {
  const rows = await duckdbQueryAsync<{ status: string | null; n: number }>(
    `SELECT v."Status" AS status, COUNT(*) AS n FROM v_campaign_send v
     WHERE v."Campaign" = ${sqlString(campaignId)}
     GROUP BY v."Status";`,
  );
  const stats: CampaignStats = {
    queued: 0, sent: 0, softBounced: 0, hardBounced: 0, complained: 0, failed: 0, cancelled: 0,
  };
  for (const row of rows) {
    const n = Number(row.n);
    switch (row.status) {
      case "Queued": stats.queued = n; break;
      case "Sent": stats.sent = n; break;
      case "Soft Bounced": stats.softBounced = n; break;
      case "Hard Bounced": stats.hardBounced = n; break;
      case "Complained": stats.complained = n; break;
      case "Failed": stats.failed = n; break;
      case "Cancelled": stats.cancelled = n; break;
    }
  }
  return stats;
}

/** One worker tick: for every Sending campaign, send the next batch. */
export async function processCampaignQueue(): Promise<void> {
  const dbPath = await duckdbPathAsync();
  if (!dbPath) {return;}

  const campaignIds = await listSendingCampaignIds();
  for (const campaignId of campaignIds) {
    const campaign = await loadCampaign(campaignId);
    if (!campaign || campaign.Status !== "Sending") {continue;}

    const batch = await listQueuedSends(campaignId, SEND_BATCH_SIZE);
    for (const send of batch) {
      const attempts = Number(send.attempts ?? "0") + 1;
      const now = new Date().toISOString();
      if (!send.email) {
        await setEntryFieldValues("campaign_send", send.entry_id, [
          ["Status", "Failed"],
          ["Error", "Missing recipient email"],
          ["Attempts", String(attempts)],
          ["Last Attempt At", now],
        ]);
        continue;
      }
      try {
        const { messageId } = await sendSesEmail({
          to: send.email,
          subject: campaign.Subject ?? "",
          body: campaign.Body ?? "",
        });
        await setEntryFieldValues("campaign_send", send.entry_id, [
          ["Status", "Sent"],
          ["SES Message ID", messageId],
          ["Attempts", String(attempts)],
          ["Last Attempt At", now],
          ["Error", ""],
        ]);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (attempts >= MAX_ATTEMPTS) {
          await setEntryFieldValues("campaign_send", send.entry_id, [
            ["Status", "Failed"],
            ["Error", message],
            ["Attempts", String(attempts)],
            ["Last Attempt At", now],
          ]);
        } else {
          const nextAttempt = new Date(Date.now() + RETRY_BACKOFF_MS[attempts - 1]).toISOString();
          await setEntryFieldValues("campaign_send", send.entry_id, [
            ["Error", message],
            ["Attempts", String(attempts)],
            ["Last Attempt At", now],
            ["Next Attempt At", nextAttempt],
          ]);
        }
      }
    }

    // Re-check status: the campaign may have been paused/cancelled mid-batch.
    const after = await loadCampaign(campaignId);
    if (!after || after.Status !== "Sending") {continue;}

    const remaining = await countSendsByStatus(campaignId, "Queued");
    if (remaining === 0) {
      const sent = await countSendsByStatus(campaignId, "Sent");
      await setEntryFieldValues("campaign", campaignId, [
        ["Status", "Sent"],
        ["Sent At", new Date().toISOString()],
        ["Recipients Count", String(sent)],
      ]);
    }
  }
}

// ---------------------------------------------------------------------------
// Bounce / complaint handling (SNS webhook)
// ---------------------------------------------------------------------------

export type SesNotification = {
  eventType?: string;
  bounce?: { bounceType?: string };
  complaint?: Record<string, unknown>;
  mail?: { messageId?: string };
};

export async function handleSesNotification(notification: SesNotification): Promise<boolean> {
  const messageId = notification.mail?.messageId;
  const eventType = notification.eventType;
  if (!messageId || !eventType) {return false;}

  const rows = await duckdbQueryAsync<{ entry_id: string; person_id: string | null; attempts: string | null }>(
    `SELECT v.entry_id, v."Person" AS person_id, v."Attempts" AS attempts
     FROM v_campaign_send v
     WHERE v."SES Message ID" = ${sqlString(messageId)} LIMIT 1;`,
  );
  const send = rows[0];
  if (!send) {return false;}

  if (eventType === "Bounce") {
    const permanent = notification.bounce?.bounceType === "Permanent";
    if (permanent) {
      await setEntryFieldValues("campaign_send", send.entry_id, [["Status", "Hard Bounced"]]);
      if (send.person_id) {
        await setEntryFieldValues("people", send.person_id, [["Email Status", "Hard Bounced"]]);
      }
    } else {
      // Transient: schedule a retry while attempts remain, else leave as
      // terminal Soft Bounced.
      const attempts = Number(send.attempts ?? "0");
      if (attempts < MAX_ATTEMPTS) {
        const nextAttempt = new Date(Date.now() + RETRY_BACKOFF_MS[Math.min(attempts, RETRY_BACKOFF_MS.length - 1)]).toISOString();
        await setEntryFieldValues("campaign_send", send.entry_id, [
          ["Status", "Queued"],
          ["Next Attempt At", nextAttempt],
        ]);
      } else {
        await setEntryFieldValues("campaign_send", send.entry_id, [["Status", "Soft Bounced"]]);
      }
    }
    return true;
  }

  if (eventType === "Complaint") {
    await setEntryFieldValues("campaign_send", send.entry_id, [["Status", "Complained"]]);
    if (send.person_id) {
      await setEntryFieldValues("people", send.person_id, [["Email Status", "Complained"]]);
    }
    return true;
  }

  return false;
}
