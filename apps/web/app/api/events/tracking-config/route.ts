import { getOrCreateTrackingWriteKey } from "@/lib/tracking";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/events/tracking-config — returns the workspace web-tracking write
 * key and the ready-to-paste tracker snippet for the Integrations UI.
 */
export async function GET(req: Request) {
  const writeKey = getOrCreateTrackingWriteKey();
  const origin = new URL(req.url).origin;
  const snippet = `<script src="${origin}/tracker.js" data-write-key="${writeKey}" defer></script>`;
  return Response.json({ writeKey, snippet, origin });
}
