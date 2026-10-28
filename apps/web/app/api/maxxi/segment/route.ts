/** GET /api/maxxi/segment — deterministic S_ARCH_RENEWAL_45D with reasons. */

import { guardPermission } from "../_guard";
import { evaluateArchRenewal45d, listCatalog } from "@/lib/maxxi/queries";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = guardPermission(req, "maxxi.people.eligible");
  if (!auth.ok) {return auth.response;}

  try {
    const [segment, catalog] = await Promise.all([evaluateArchRenewal45d(), listCatalog()]);
    return Response.json({ ok: true, segment, catalog });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Segment query failed." },
      { status: 500 },
    );
  }
}
