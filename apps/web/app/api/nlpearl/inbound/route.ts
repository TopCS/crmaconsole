/**
 * POST /api/nlpearl/inbound — create the inbound customer-care Pearl.
 *
 * Body: { name, phoneId?, brief? }
 *   name   — Pearl name
 *   phoneId — NLPearl phone number ID (assigned to the inbound number)
 *   brief  — optional Marketing Message MD the agent should speak
 *
 * Auth: same Bearer secret as the phone webhook (CRM_A_PHONE_WEBHOOK_SECRET).
 */

import { createInboundPearl } from "@/lib/nlpearl-inbound";
import { isPhoneWebhookAuthorized } from "@/lib/phone-webhook";
import { resolveAppPublicOrigin } from "@/lib/public-origin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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