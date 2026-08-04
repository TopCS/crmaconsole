import { loadCampaign, resolveAudience } from "@/lib/campaigns";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/crm/campaigns/[id]/audience — emailable-audience preview for the
 * campaign editor (members of the selected segment that have an email).
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const campaign = await loadCampaign(id);
  if (!campaign) {
    return Response.json({ error: "Campaign not found." }, { status: 404 });
  }
  if (!campaign.Segment) {
    return Response.json({ total: 0, sample: [], segmentMissing: true });
  }
  try {
    const audience = await resolveAudience(campaign.Segment);
    return Response.json({
      total: audience.length,
      sample: audience.slice(0, 8),
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to resolve audience." },
      { status: 500 },
    );
  }
}
