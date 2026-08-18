/**
 * POST /api/nlpearl/inbound — manage the inbound customer-care Pearl.
 *
 * Body: { action?: "create" | "activate" | "pause", name?, phoneId?, brief?, pearlId? }
 *   action  — "create" (default): build the inbound customer-care Pearl.
 *             "activate"/"pause": toggle the Pearl's activity.
 *   name    — Pearl name (create)
 *   phoneId — NLPearl phone number ID assigned to the inbound number (create)
 *   brief   — optional Marketing Message MD the agent should speak (create)
 *   pearlId — Pearl ID (activate/pause)
 *
 * Auth: same Bearer secret as the phone webhook (CRM_A_PHONE_WEBHOOK_SECRET).
 */

import { createInboundPearl } from "@/lib/nlpearl-inbound";
import { setPearlActive } from "@/lib/nlpearl";
import { isPhoneWebhookAuthorized } from "@/lib/phone-webhook";
import { resolveAppPublicOrigin } from "@/lib/public-origin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ACTIONS = ["create", "activate", "pause"] as const;
type Action = (typeof ACTIONS)[number];

export async function POST(req: Request) {
  if (!isPhoneWebhookAuthorized(req)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const action = typeof body.action === "string" && ACTIONS.includes(body.action as Action)
    ? (body.action as Action)
    : "create";

  if (action === "activate" || action === "pause") {
    const pearlId = typeof body.pearlId === "string" && body.pearlId.trim()
      ? body.pearlId.trim()
      : undefined;
    if (!pearlId) {
      return Response.json({ error: "pearlId is required for activate/pause." }, { status: 400 });
    }
    try {
      await setPearlActive(pearlId, action === "activate");
      return Response.json({ ok: true, pearlId, active: action === "activate" });
    } catch (err) {
      return Response.json(
        { error: err instanceof Error ? err.message : `Failed to ${action} inbound Pearl.` },
        { status: 500 },
      );
    }
  }

  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : "Customer Care";
  const phoneId = typeof body.phoneId === "string" ? body.phoneId.trim() : undefined;
  const brief = typeof body.brief === "string" && body.brief.trim() ? body.brief.trim() : undefined;

  try {
    const pearlId = await createInboundPearl({
      origin: resolveAppPublicOrigin(req),
      name,
      phoneId,
      brief,
    });
    return Response.json({ ok: true, pearlId });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to create inbound Pearl." },
      { status: 500 },
    );
  }
}
