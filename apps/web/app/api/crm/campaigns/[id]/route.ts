import { deleteCampaign, loadCampaign } from "@/lib/campaigns";
import { teardownPhoneCampaignPearl } from "@/lib/campaign-phone";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * DELETE /api/crm/campaigns/[id] — removes the campaign AND its send-log
 * rows (the generic entries DELETE would orphan them).
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const campaign = await loadCampaign(id);
  if (!campaign) {
    return Response.json({ error: "Campaign not found." }, { status: 404 });
  }
  let teardown: Awaited<ReturnType<typeof teardownPhoneCampaignPearl>> | null = null;
  try {
    teardown = await teardownPhoneCampaignPearl(id);
  } catch (err) {
    console.error("[campaigns] NLPearl teardown failed:", err);
  }
  await deleteCampaign(id);
  return Response.json({
    deleted: true,
    ...(teardown?.pearlId ? { pearlPaused: teardown.paused, pearlLeadsDeleted: teardown.leadsDeleted } : {}),
  });
}
