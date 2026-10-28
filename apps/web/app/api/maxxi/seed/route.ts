/** POST /api/maxxi/seed — admin-only deterministic seed/reset of the MAXXI demo DB. */

import { guardPermission, principalUsername } from "../_guard";
import { seedMaxxiDemo } from "@/lib/maxxi/seed";
import { recordAudit } from "@/lib/maxxi/queries";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const auth = guardPermission(req, "maxxi.seed");
  if (!auth.ok) {return auth.response;}

  try {
    const summary = await seedMaxxiDemo();
    await recordAudit({
      principalId: principalUsername(auth.principal),
      action: "maxxi_seed",
      targetId: summary.workspaceId,
      status: "ok",
      details: summary.counts,
    });
    return Response.json({ ...summary, banner: "DEMO - DATI SINTETICI - NESSUN INVIO ESTERNO" });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Seed failed." },
      { status: 500 },
    );
  }
}
