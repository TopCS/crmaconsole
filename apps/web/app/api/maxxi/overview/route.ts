/** GET /api/maxxi/overview — dashboard KPIs, sources and review queue. */

import { guard } from "../_guard";
import { getDashboardKpis, listReviewCandidates, listSources } from "@/lib/maxxi/queries";
import { MAXXI_CLOCK_ISO } from "@/lib/maxxi/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = guard(req);
  if (!auth.ok) {return auth.response;}

  try {
    const [kpis, sources, reviews] = await Promise.all([
      getDashboardKpis(),
      listSources(),
      listReviewCandidates(),
    ]);
    return Response.json({
      ok: true,
      banner: "DEMO - DATI SINTETICI - NESSUN INVIO ESTERNO",
      clock: MAXXI_CLOCK_ISO,
      kpis,
      sources,
      reviews,
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Overview failed." },
      { status: 500 },
    );
  }
}
