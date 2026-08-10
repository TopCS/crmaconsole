/**
 * POST /api/campaigns/phone — phone-campaign orchestration (NLPearl).
 *
 * Body: { action: "create" | "send" | "pause" | "resume", campaignId, origin? }
 *
 *   create  → create/update the NLPearl Outbound Pearl for this campaign
 *             (stores Pearl ID back on the campaign)
 *   send    → enqueue the campaign's audience as NLPearl leads + campaign_send
 *             rows (`External ID` = NLPearl lead id)
 *   pause   → setPearlActive(false)
 *   resume  → setPearlActive(true)
 *
 * Auth: same Bearer secret as the phone webhook (CRM_A_PHONE_WEBHOOK_SECRET).
 */

import {
  createPhonePearlForCampaign,
  enqueuePhoneCampaign,
  setCampaignPearlPaused,
} from "@/lib/campaign-phone";
import { isPhoneWebhookAuthorized } from "@/lib/phone-webhook";
import { resolveAppPublicOrigin } from "@/lib/public-origin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ACTIONS = ["create", "send", "pause", "resume"] as const;
type Action = (typeof ACTIONS)[number];

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
  const action = typeof body.action === "string" ? (body.action as Action) : "";
  if (!ACTIONS.includes(action as Action)) {
    return jsonError(`Unknown action '${String(action)}'.`, 400);
  }
  const campaignId = typeof body.campaignId === "string" ? body.campaignId.trim() : "";
  if (!campaignId) {
    return jsonError("campaignId is required.", 400);
  }
  const origin = resolveAppPublicOrigin(req);

  try {
    switch (action) {
      case "create": {
        const pearlId = await createPhonePearlForCampaign(campaignId, origin);
        return Response.json({ ok: true, pearlId });
      }
      case "send": {
        const result = await enqueuePhoneCampaign(campaignId);
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