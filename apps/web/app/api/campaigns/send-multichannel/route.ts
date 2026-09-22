/**
 * POST /api/campaigns/send-multichannel — orchestrate a launch (Atto 3).
 *
 * Given a segment, sends the message to each member routing by their
 * `Preferred Contact Channel`: email via SES, Telegram via the OpenClaw
 * runtime (`deliverToSession`). Per-recipient failures are collected and
 * returned, never failing the whole run.
 *
 * Body:
 *   { "segmentEntryId": "...", "subject": "…", "body": "…" }
 *   { "segmentEntryId": "...", "subject": "…", "body": "…", "preview": true }
 *     → dry-run: nothing is sent; returns the per-channel routing matrix.
 *
 * Auth: same Bearer secret as the phone webhook (CRM_A_PHONE_WEBHOOK_SECRET).
 * Closed when the secret is not configured.
 */

import { sendCampaignMultichannel } from "@/lib/campaigns";
import { resolveSegmentIdByName } from "@/lib/campaign-phone";
import { isPhoneWebhookAuthorized } from "@/lib/phone-webhook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

export async function POST(req: Request) {
  if (!isPhoneWebhookAuthorized(req)) {
    return jsonError("Unauthorized", 401);
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonError("Invalid JSON body.", 400);
  }

  const subject = typeof body.subject === "string" ? body.subject.trim() : "";
  const message = typeof body.body === "string" ? body.body.trim() : "";
  if (!message) {
    return jsonError("body is required.", 400);
  }

  let segmentEntryId = typeof body.segmentEntryId === "string" ? body.segmentEntryId.trim() : "";
  const segmentName = typeof body.segmentName === "string" ? body.segmentName.trim() : "";
  if (!segmentEntryId && segmentName) {
    segmentEntryId = (await resolveSegmentIdByName(segmentName)) ?? "";
  }
  if (!segmentEntryId) {
    return jsonError(
      segmentName
        ? `Segment "${segmentName}" not found.`
        : "segmentEntryId or segmentName is required.",
      400,
    );
  }

  try {
    const result = await sendCampaignMultichannel({
      segmentEntryId,
      subject,
      body: message,
      preview: body.preview === true,
    });
    return Response.json({ ok: true, ...result });
  } catch (err) {
    return jsonError(
      err instanceof Error ? err.message : "Multichannel send failed.",
      500,
    );
  }
}
