/** POST /api/maxxi/ask — deterministic grounded answers (no cloud provider). */

import { guard, jsonError } from "../_guard";
import { askMaxxi } from "@/lib/maxxi/agent";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const auth = guard(req);
  if (!auth.ok) {return auth.response;}

  let body: { question?: unknown };
  try {
    body = (await req.json()) as { question?: unknown };
  } catch {
    return jsonError("Invalid JSON body.");
  }
  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (!question) {return jsonError("question is required.");}
  if (question.length > 500) {return jsonError("question too long.");}

  const answer = await askMaxxi(question);
  return Response.json({ ok: true, answer });
}
