/**
 * GET /api/maxxi/graph?type=person,catalog&focus=P-MARIA&depth=2
 *
 * Read-only relationship graph over the isolated MAXXI demo database.
 * Requires `maxxi.people.read`: the graph contains personal identifiers.
 */

import { guardPermission } from "../_guard";
import { filterMaxxiGraph, getMaxxiGraph } from "@/lib/maxxi/graph";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = guardPermission(req, "maxxi.people.read");
  if (!auth.ok) {return auth.response;}

  const url = new URL(req.url);
  const types = (url.searchParams.get("type") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const focus = url.searchParams.get("focus")?.trim() || undefined;
  const depthRaw = Number(url.searchParams.get("depth") ?? "");
  const depth = Number.isFinite(depthRaw) ? Math.floor(depthRaw) : undefined;

  const graph = filterMaxxiGraph(await getMaxxiGraph(), { types, focus, depth });
  return Response.json(graph, { headers: { "Cache-Control": "no-store" } });
}
