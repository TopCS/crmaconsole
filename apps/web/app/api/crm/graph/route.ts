import { fetchCrmGraph, type CrmGraph } from "@/lib/crm-graph";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/crm/graph?type=people,company&focus=<id|label>&depth=2
 *
 * Read-only property-graph view over the workspace. Returns:
 *   { nodes: [{id, label, type}], edges: [{source, target, type, rel}], truncated }
 *
 * - `type`   comma-separated object names to keep (server-side filter)
 * - `focus`  entry id or label; combined with `depth` restricts the result
 *            to that node's N-hop neighborhood
 * - `depth`  hop count (1–3), only meaningful with `focus`
 *
 * No writes to the workspace — pure SELECT projection over the EAV tables.
 */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);

  const typeParam = url.searchParams.get("type") ?? "";
  const types = typeParam
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  const focus = url.searchParams.get("focus")?.trim() || undefined;
  const depthRaw = Number(url.searchParams.get("depth") ?? "");
  const depth = Number.isFinite(depthRaw) ? Math.floor(depthRaw) : undefined;

  const graph: CrmGraph = await fetchCrmGraph({ types, focus, depth });

  return Response.json(graph, {
    headers: { "Cache-Control": "no-store" },
  });
}
