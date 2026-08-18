import { fetchGraphNodeDetail } from "@/lib/crm-graph";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/crm/graph/node?entryId=<id>
 *
 * Lazily-fetched full field map for a single graph vertex (shown in the
 * detail side panel when the user clicks a node). Keeps the bulk graph
 * payload lean by not embedding every field on every node.
 */
export async function GET(req: Request): Promise<Response> {
  const entryId = new URL(req.url).searchParams.get("entryId")?.trim();
  if (!entryId) {
    return Response.json({ error: "entryId is required" }, { status: 400 });
  }

  const detail = await fetchGraphNodeDetail(entryId);
  if (!detail) {
    return Response.json({ error: "entry not found" }, { status: 404 });
  }

  return Response.json(detail, { headers: { "Cache-Control": "no-store" } });
}
