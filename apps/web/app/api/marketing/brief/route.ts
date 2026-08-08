/**
 * GET /api/marketing/brief — export the marketing brief as Markdown.
 *
 * Produces the launch brief (product + launch facts, official marketing copy,
 * comparison vs the previous generation, target audience, memory example) for
 * import into the phone environment. Downloadable as `<product>.md` or
 * consumed as text/plain by an import client.
 *
 * Query: ?promotedSku=&previousSku= (optional; defaults to the Upcoming product
 * and the newest non-promoted catalog entry).
 *
 * Auth: same Bearer secret as the phone webhook (CRM_A_PHONE_WEBHOOK_SECRET).
 */

import { buildMarketingBrief } from "@/lib/marketing-brief";
import { isPhoneWebhookAuthorized } from "@/lib/phone-webhook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  if (!isPhoneWebhookAuthorized(req)) {
    return new Response("Unauthorized", { status: 401 });
  }
  const url = new URL(req.url);
  const promotedSku = url.searchParams.get("promotedSku")?.trim() || undefined;
  const previousSku = url.searchParams.get("previousSku")?.trim() || undefined;

  try {
    const brief = await buildMarketingBrief({ promotedSku, previousSku });
    const slug = (promotedSku ?? "brief").toLowerCase().replace(/[^a-z0-9]+/g, "-");
    return new Response(brief, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="${slug}.md"`,
      },
    });
  } catch (err) {
    return new Response(
      err instanceof Error ? err.message : "Failed to build brief.",
      { status: 500 },
    );
  }
}
