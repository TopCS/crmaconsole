/**
 * POST /api/maxxi/chat — optional LLM chat, strictly grounded on MAXXI tools.
 *
 * Guarded by `maxxi.view`. The model can only call the tools allowed for the
 * caller's role (read-only, no outbound/approval/seed). Any provider error,
 * timeout or tool-less answer falls back to the deterministic engine.
 */

import { guardPermission, principalUsername } from "../_guard";
import { recordAudit } from "@/lib/maxxi/queries";
import {
  buildTools,
  chatWithMaxxi,
  toolNamesForRoles,
  toolNamesForService,
} from "@/lib/maxxi/chat";
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

  const toolNames =
    auth.principal.sub === "operator"
      ? toolNamesForRoles(auth.principal.roles)
      : toolNamesForService();

  // The deterministic fallback is only safe when the role is allowed the
  // broad `maxxi_ask` tool. Otherwise it could answer a person/segment question
  // that the role cannot see in the UI. Restricted roles get a refusal instead.
  const deterministic = toolNames.includes("maxxi_ask")
    ? askMaxxi
    : async (value: string) => ({
        question: value,
        intent: "restricted",
        answer: "Non ho evidenze sufficienti su questo punto nei dati demo caricati.",
        grounded: false,
        evidence: [],
        citations: [],
        fallback: true as const,
      });

  const answer = await chatWithMaxxi({
    question,
    tools: buildTools(toolNames),
    deterministic,
  });

  try {
    await recordAudit({
      principalId: principalUsername(auth.principal),
      action: "maxxi_chat_query",
      targetId: "assistant",
      status: answer.mode === "llm" ? "ok" : "fallback",
      details: {
        mode: answer.mode,
        tools: answer.toolsUsed,
        model: answer.model,
        fallbackReason: answer.fallbackReason,
        questionLength: question.length,
      },
    });
  } catch {
    // Audit is best-effort: never break the answer because the demo DB is busy.
  }

  return Response.json({ ok: true, answer });
}
