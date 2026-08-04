import { sendCampaign } from "@/lib/campaigns";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/crm/campaigns/[id]/send — sends the campaign to its segment
 * audience through the connected Gmail account. Fails with a clear reason
 * when no Gmail connection exists (no Crm-A Cloud key / not connected).
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const result = await sendCampaign(id);
    return Response.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes("No Gmail connection") || message.includes("not found")
      ? 400
      : 500;
    return Response.json({ error: message }, { status });
  }
}
