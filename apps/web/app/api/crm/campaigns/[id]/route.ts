import { deleteCampaign, loadCampaign } from "@/lib/campaigns";

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
  await deleteCampaign(id);
  return Response.json({ deleted: true });
}
