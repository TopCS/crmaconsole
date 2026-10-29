/**
 * GET /api/maxxi/graph/node?id=P-MARIA
 *
 * Lazy details for one graph node. Person details omit infopoint notes.
 */

import { guardPermission } from "../../_guard";
import { getMaxxiGraphNodeDetail } from "@/lib/maxxi/graph";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = guardPermission(req, "maxxi.people.read");
  if (!auth.ok) {return auth.response;}

  const id = new URL(req.url).searchParams.get("id")?.trim();
  if (!id) {return Response.json({ error: "id is required." }, { status: 400 });}

  const detail = await getMaxxiGraphNodeDetail(id);
  if (!detail) {return Response.json({ error: "Nodo non trovato." }, { status: 404 });}

  return Response.json(detail, { headers: { "Cache-Control": "no-store" } });
}
