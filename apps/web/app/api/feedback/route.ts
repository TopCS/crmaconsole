import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { resolveWebChatDir } from "@/lib/workspace";
import { trackServer } from "@/lib/telemetry";

export const runtime = "nodejs";

type ChatLine = {
  id: string;
  role: "user" | "assistant";
  content: string;
  parts?: Array<Record<string, unknown>>;
};

function extractTextContent(line: ChatLine): string {
  if (line.parts) {
    return line.parts
      .filter((p) => p.type === "text" && typeof p.text === "string")
      .map((p) => p.text as string)
      .join("");
  }
  return line.content;
}

/**
 * POST /api/feedback
 *
 * When a user submits thumbs up/down feedback, emit an un-redacted
 * $ai_trace event to PostHog so the full conversation is visible
 * in LLM Analytics regardless of the extension's privacy mode.
 */
export async function POST(req: Request) {
  try {
    const { sessionId, messageId, distinctId } = (await req.json()) as {
      sessionId?: string;
      messageId?: string;
      distinctId?: string;
    };
    if (!sessionId) {
      return Response.json({ ok: true });
    }

    const filePath = join(resolveWebChatDir(), `${sessionId}.jsonl`);
    if (!existsSync(filePath)) {
      return Response.json({ ok: true });
    }

    const lines: ChatLine[] = readFileSync(filePath, "utf-8")
      .trim()
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => {
        try { return JSON.parse(l) as ChatLine; } catch { return null; }
      })
      .filter((m): m is ChatLine => m !== null);

    // Include all messages up to (and including) the feedback target.
    let cutoff = lines.length;
    if (messageId) {
      const idx = lines.findIndex((m) => m.id === messageId);
      if (idx >= 0) cutoff = idx + 1;
    }
    const conversation = lines.slice(0, cutoff);

    const inputState = conversation
      .filter((m) => m.role === "user")
      .map((m) => ({ role: "user" as const, content: extractTextContent(m) }));
    const outputState = conversation
      .filter((m) => m.role === "assistant")
      .map((m) => ({ role: "assistant" as const, content: extractTextContent(m) }));

    trackServer(
      "$ai_trace",
      {
        $ai_trace_id: sessionId,
        $ai_session_id: sessionId,
        $ai_span_name: "chat_session",
        $ai_input_state: inputState.length > 0 ? inputState : undefined,
        $ai_output_state: outputState.length > 0 ? outputState : undefined,
      },
      distinctId,
    );
  } catch {
    // Fail silently -- feedback capture should never block the user.
  }

  return Response.json({ ok: true });
}
