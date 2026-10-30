/**
 * GET  /api/maxxi/review — review cases with possible person matches.
 * POST /api/maxxi/review — simulated decision (keep separate / merge simulated).
 *
 * A "merge_simulated" decision records the decision and audit only: it never
 * mutates person, identity-link or consent rows.
 */

import { guardPermission, principalUsername } from "../_guard";
import { decideReviewCandidate, listReviewCases } from "@/lib/maxxi/queries";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = guardPermission(req, "maxxi.people.read");
  if (!auth.ok) {return auth.response;}
  const cases = await listReviewCases();
  return Response.json({ ok: true, cases });
}

export async function POST(req: Request) {
  const auth = guardPermission(req, "maxxi.people.review");
  if (!auth.ok) {return auth.response;}

  let body: { candidateId?: unknown; decision?: unknown; reason?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const candidateId = typeof body.candidateId === "string" ? body.candidateId.trim() : "";
  const decision = body.decision === "merge_simulated" ? "merge_simulated" : body.decision === "keep_separate" ? "keep_separate" : null;
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!candidateId || !decision) {
    return Response.json({ error: "candidateId e decision sono obbligatori." }, { status: 400 });
  }
  if (reason.length < 5 || reason.length > 500) {
    return Response.json({ error: "La motivazione deve avere tra 5 e 500 caratteri." }, { status: 400 });
  }

  const result = await decideReviewCandidate({
    candidateId,
    decision,
    reason,
    principalId: principalUsername(auth.principal),
  });
  if (!result.ok) {return Response.json({ error: result.reason }, { status: 400 });}
  return Response.json({
    ok: true,
    candidateId,
    decision,
    applied: false,
    note: "Decisione simulata: nessuna fusione o modifica ai profili è stata eseguita.",
  });
}
