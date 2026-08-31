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
  const campaignId = asString(body.campaignId) ?? "";
  // NLPearl's cloud must REACH these webhook URLs, so the origin is always
  // the public one (env first). resolveAppPublicOrigin would trust
  // x-forwarded-host — e.g. the gateway's localhost host header — which
  // NLPearl rejects ("Invalid Webhook URL").
  const origin = process.env.CRM_A_CONSOLE_PUBLIC_URL?.trim() || resolveAppPublicOrigin(req);
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

  if (!campaignId) {
    return jsonError("campaignId is required.", 400);
  }

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
          ? await enqueuePhoneCampaign(campaignId, criteria, origin)
          : await enqueuePhoneCampaign(campaignId, undefined, origin);
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