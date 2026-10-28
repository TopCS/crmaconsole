/** POST /api/maxxi/ask — deterministic grounded answers (no cloud provider). */

import { guardPermission } from "../_guard";
import { askMaxxi } from "@/lib/maxxi/agent";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const auth = guardPermission(req, "maxxi.view");
  if (!auth.ok) {return auth.response;}

  let body: { question?: unknown };
  try {
    body = (await req.json()) as { question?: unknown };
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (!question) {return Response.json({ error: "question is required." }, { status: 400 });}
  if (question.length > 500) {return Response.json({ error: "question too long." }, { status: 400 });}

  const answer = await askMaxxi(question);
  return Response.json({ ok: true, answer });
}
