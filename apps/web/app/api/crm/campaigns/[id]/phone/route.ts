import {
  enqueuePhoneCampaign,
  setCampaignPearlPaused,
  upsertPhoneCampaign,
  type PhoneAudienceCriteria,
} from "@/lib/campaign-phone";
import { resolveAppPublicOrigin } from "@/lib/public-origin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/crm/campaigns/[id]/phone — phone-channel controls for the console
 * UI (the same operations the agent drives through `crm_a_phone_campaign`).
 *
 * The Campagne view is one list for every channel, so a campaign whose
 * `Channel` is Phone must be operable from there instead of only from the
 * generic entry card: send the leads to NLPearl, pause/resume the Pearl, or
 * update the phone configuration.
 *
 * Body:
 *   { action: "send" | "pause" | "resume" | "upsert",
 *     criteria?: { segmentId?, count? },
 *     ...upsert payload: phoneNumber|phoneId, windowStart, windowEnd, timezone,
 *                        days, brief, brandName, greetingScript, knowledgeBase,
 *                        segmentName, maxAttempts, retryRate, agentCount }
 */

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function asNumber(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) {
    return v;
  }
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const action = typeof body.action === "string" ? body.action : "";

  try {
    switch (action) {
      case "upsert": {
        const daysRaw = body.days;
        const days = Array.isArray(daysRaw)
          ? daysRaw.filter((d): d is number => typeof d === "number")
          : typeof daysRaw === "string"
            ? daysRaw
                .replace(/[[\]]/g, "")
                .split(",")
                .map((d) => Number(d.trim()))
                .filter((d) => Number.isFinite(d))
            : undefined;
        const campaignId = await upsertPhoneCampaign({
          campaignId: id,
          name: asString(body.name),
          phoneId: asString(body.phoneNumber) ?? asString(body.phoneId),
          windowStart: asString(body.windowStart),
          windowEnd: asString(body.windowEnd),
          timezone: asString(body.timezone),
          days,
          maxAttempts: asNumber(body.maxAttempts),
          retryRate: asNumber(body.retryRate),
          agentCount: asNumber(body.agentCount),
          brief: asString(body.brief),
          brandName: asString(body.brandName),
          greetingScript: asString(body.greetingScript),
          knowledgeBase: asString(body.knowledgeBase),
          segmentName: asString(body.segmentName),
        });
        return Response.json({ ok: true, campaignId });
      }
      case "send": {
        const raw = body.criteria;
        const criteria: PhoneAudienceCriteria | undefined =
          raw && typeof raw === "object"
            ? {
                ...(asString((raw as Record<string, unknown>).segmentId)
                  ? { segmentId: asString((raw as Record<string, unknown>).segmentId) }
                  : {}),
                ...(asNumber((raw as Record<string, unknown>).count) !== undefined
                  ? { count: asNumber((raw as Record<string, unknown>).count) }
                  : {}),
              }
            : undefined;
        const origin =
          process.env.CRM_A_CONSOLE_PUBLIC_URL?.trim() || resolveAppPublicOrigin(req);
        const result = await enqueuePhoneCampaign(id, criteria, origin);
        return Response.json({ ok: true, ...result });
      }
      case "pause":
        await setCampaignPearlPaused(id, true);
        return Response.json({ ok: true, paused: true });
      case "resume":
        await setCampaignPearlPaused(id, false);
        return Response.json({ ok: true, paused: false });
      default:
        return Response.json(
          { error: `Unknown action "${action}" (use send|pause|resume|upsert).` },
          { status: 400 },
        );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Phone campaign action failed.";
    const status = message.toLowerCase().includes("not found") ? 404 : 400;
    return Response.json({ error: message }, { status });
  }
}
