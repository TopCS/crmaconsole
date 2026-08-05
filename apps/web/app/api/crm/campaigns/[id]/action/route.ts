import { cancelCampaign, pauseCampaign, resumeCampaign } from "@/lib/campaigns";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/crm/campaigns/[id]/action — lifecycle control for a running
 * campaign. Body: { action: "pause" | "resume" | "cancel" }.
 */
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
      case "pause":
        await pauseCampaign(id);
        return Response.json({ status: "Paused" });
      case "resume":
        await resumeCampaign(id);
        return Response.json({ status: "Sending" });
      case "cancel":
        await cancelCampaign(id);
        return Response.json({ status: "Cancelled" });
      default:
        return Response.json({ error: `Unknown action "${action}".` }, { status: 400 });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes("not found") ? 404 : 400;
    return Response.json({ error: message }, { status });
  }
}
