import { campaignStats } from "@/lib/campaigns";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/crm/campaigns/[id]/stats — live per-status counts from the send
 * log (queued/sent/soft+hard bounced/complained/failed/cancelled).
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const stats = await campaignStats(id);
    return Response.json(stats);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to load stats." },
      { status: 500 },
    );
  }
}
