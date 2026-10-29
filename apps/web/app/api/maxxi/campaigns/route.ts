/**
 * GET  /api/maxxi/campaigns — list drafts and audit trail (maxxi.view).
 * POST /api/maxxi/campaigns — create a dry-run draft (campaigns.create).
 * POST /api/maxxi/campaigns?action=approve&id=<id> — simulated approval
 *      (campaigns.approve).
 */

import { guardPermission, principalUsername } from "../_guard";
import {
  approveCampaignSimulated,
  createCampaignDraft,
  getCampaignDetail,
  listAudit,
  listCampaigns,
} from "@/lib/maxxi/queries";
import { roleHasPermission } from "@/lib/security/rbac";
import { isDemoMode } from "@/lib/security/demo-mode";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = guardPermission(req, "maxxi.view");
  if (!auth.ok) {return auth.response;}

  const id = new URL(req.url).searchParams.get("id")?.trim();
  if (id) {
    const detail = await getCampaignDetail(id);
    if (!detail) {return Response.json({ error: "Campagna non trovata." }, { status: 404 });}

    // Recipients are personal data: only roles with people.read see names and
    // emails. Other roles still see counts, reasons and the campaign text.
    const canSeePeople =
      auth.principal.sub === "service" ||
      roleHasPermission(auth.principal.roles, "maxxi.people.read");
    const excludedGroups = Object.entries(
      detail.segment.excluded.reduce<Record<string, number>>((acc, member) => {
        acc[member.segmentReason] = (acc[member.segmentReason] ?? 0) + 1;
        return acc;
      }, {}),
    ).map(([reason, count]) => ({ reason, count }));

    return Response.json({
      ok: true,
      campaign: detail.campaign,
      segment: {
        segmentId: detail.segment.segmentId,
        segmentName: detail.segment.segmentName,
        windowFrom: detail.segment.windowFrom,
        windowTo: detail.segment.windowTo,
        counts: detail.segment.counts,
        eligible: canSeePeople ? detail.segment.eligible : [],
        excluded: canSeePeople ? detail.segment.excluded : [],
      },
      excludedGroups,
      recipientsVisible: canSeePeople,
      audit: detail.audit,
      demoMode: isDemoMode(),
    });
  }

  const [campaigns, audit] = await Promise.all([listCampaigns(), listAudit(50)]);
  return Response.json({ ok: true, campaigns, audit, demoMode: isDemoMode() });
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  const action = url.searchParams.get("action");
  const campaignId = url.searchParams.get("id")?.trim();

  if (action === "approve") {
    const auth = guardPermission(req, "maxxi.campaigns.approve");
    if (!auth.ok) {return auth.response;}
    if (!campaignId) {return Response.json({ error: "id is required for approve." }, { status: 400 });}
    const result = await approveCampaignSimulated({
      campaignId,
      principalId: principalUsername(auth.principal),
    });
    return Response.json(result);
  }

  const auth = guardPermission(req, "maxxi.campaigns.create");
  if (!auth.ok) {return auth.response;}

  let body: { subject?: unknown; body?: unknown };
  try {
    body = (await req.json()) as { subject?: unknown; body?: unknown };
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const subject = typeof body.subject === "string" ? body.subject.trim() : "";
  const content = typeof body.body === "string" ? body.body.trim() : "";
  if (!subject || !content) {return Response.json({ error: "subject and body are required." }, { status: 400 });}

  const draft = await createCampaignDraft({
    subject,
    body: content,
    principalId: principalUsername(auth.principal),
  });
  return Response.json({ ok: true, draft });
}
