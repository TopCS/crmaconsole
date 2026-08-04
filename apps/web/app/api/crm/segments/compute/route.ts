import { computeSegmentCount, type SegmentDefinition } from "@/lib/segments";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/crm/segments/compute — live member-count preview for the
 * segment builder. Body: SegmentDefinition { filters?, events? }.
 */
export async function POST(req: Request) {
  let def: SegmentDefinition;
  try {
    def = (await req.json()) as SegmentDefinition;
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  try {
    const count = await computeSegmentCount(def);
    return Response.json({ count });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to compute segment." },
      { status: 500 },
    );
  }
}
