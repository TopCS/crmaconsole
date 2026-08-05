import { enqueueCampaign } from "@/lib/campaigns";
import { isSesConfigured } from "@/lib/ses";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/crm/campaigns/[id]/send — validates the campaign, enqueues its
 * audience into the send log and flips it to Sending. The worker drains the
 * queue in batches; use pause/resume/cancel to control the run.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!isSesConfigured()) {
    return Response.json(
      { error: "AWS SES is not configured. Add credentials in Integrations → AWS SES." },
      { status: 400 },
    );
  }
  try {
    const { queued } = await enqueueCampaign(id);
    return Response.json({ status: "Sending", queued });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes("not found") ? 404 : 400;
    return Response.json({ error: message }, { status });
  }
}
