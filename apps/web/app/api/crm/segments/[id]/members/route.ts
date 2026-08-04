import { duckdbQueryAsync } from "@/lib/workspace";
import { sqlString } from "@/lib/crm-queries";
import {
  listSegmentMembers,
  updateSegmentCache,
  type SegmentDefinition,
} from "@/lib/segments";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/crm/segments/[id]/members?limit=50&offset=0
 *
 * Loads the segment's saved definition (Filter JSON on the segment entry),
 * computes membership on demand and refreshes the cached Member Count /
 * Computed At fields.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id || id.length > 64) {
    return Response.json({ error: "Invalid segment id." }, { status: 400 });
  }

  const rows = await duckdbQueryAsync<{ filter: string | null; name: string | null }>(
    `SELECT v."Filter" AS filter, v."Name" AS name FROM v_segment v WHERE v.entry_id = ${sqlString(id)} LIMIT 1;`,
  );
  const segment = rows[0];
  if (!segment) {
    return Response.json({ error: "Segment not found." }, { status: 404 });
  }

  let def: SegmentDefinition = {};
  if (segment.filter) {
    try {
      def = JSON.parse(segment.filter) as SegmentDefinition;
    } catch {
      return Response.json({ error: "Segment filter is not valid JSON." }, { status: 500 });
    }
  }

  const url = new URL(req.url);
  const limit = Number(url.searchParams.get("limit") ?? "50");
  const offset = Number(url.searchParams.get("offset") ?? "0");

  try {
    const { total, members } = await listSegmentMembers(def, { limit, offset });
    await updateSegmentCache(id, total);
    return Response.json({ total, members, name: segment.name });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to compute members." },
      { status: 500 },
    );
  }
}
