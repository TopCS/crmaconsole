import { trackServer } from "@/lib/telemetry";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { messageId, sessionId, sentiment } = body as {
      messageId?: string;
      sessionId?: string;
      sentiment?: "positive" | "negative" | null;
    };

    if (!messageId || !sentiment) {
      return Response.json({ ok: true });
    }

    trackServer("survey sent", {
      $survey_id: process.env.POSTHOG_FEEDBACK_SURVEY_ID || "dench-feedback",
      $survey_response: sentiment === "positive" ? 1 : 2,
      $ai_trace_id: sessionId,
      message_id: messageId,
    });
  } catch {
    // Fail silently -- feedback capture should never block the user.
  }

  return Response.json({ ok: true });
}
