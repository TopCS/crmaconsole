/**
 * GET  /api/maxxi/campaigns — list drafts and audit trail.
 * POST /api/maxxi/campaigns — create a dry-run draft (no send).
 * POST /api/maxxi/campaigns?id=<id>&action=approve — simulated approval.
 */

import { guard, jsonError } from "../_guard";
import {
  approveCampaignSimulated,
  createCampaignDraft,
  listAudit,
  listCampaigns,
} from "@/lib/maxxi/queries";
import { isDemoMode } from "@/lib/security/demo-mode";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = guard(req);
  if (!auth.ok) {return auth.response;}
  const [campaigns, audit] = await Promise.all([listCampaigns(), listAudit(50)]);
  return Response.json({ ok: true, campaigns, audit, demoMode: isDemoMode() });
}

export async function POST(req: Request) {
  const auth = guard(req);
  if (!auth.ok) {return auth.response;}

  const url = new URL(req.url);
  const action = url.searchParams.get("action");
  const campaignId = url.searchParams.get("id")?.trim();

  if (action === "approve") {
    if (!campaignId) {return jsonError("id is required for approve.");}
    const result = await approveCampaignSimulated({
      campaignId,
      principalId: auth.principal.sub,
    });
    return Response.json(result);
  }

  let body: { subject?: unknown; body?: unknown };
  try {
    body = (await req.json()) as { subject?: unknown; body?: unknown };
  } catch {
    return jsonError("Invalid JSON body.");
  }
  const subject = typeof body.subject === "string" ? body.subject.trim() : "";
  const content = typeof body.body === "string" ? body.body.trim() : "";
  if (!subject || !content) {return jsonError("subject and body are required.");}

  const draft = await createCampaignDraft({
    subject,
    body: content,
    principalId: auth.principal.sub,
  });
  return Response.json({ ok: true, draft });
}
