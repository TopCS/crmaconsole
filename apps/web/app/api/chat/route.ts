import type { UIMessage } from "ai";
import { runAgent } from "@/lib/agent-runner";

// Force Node.js runtime (required for child_process)
export const runtime = "nodejs";

// Allow streaming responses up to 10 minutes
export const maxDuration = 600;

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();

  // Extract the latest user message text
  const lastUserMessage = messages.filter((m) => m.role === "user").pop();
  const userText =
    lastUserMessage?.parts
      ?.filter((p): p is { type: "text"; text: string } => p.type === "text")
      .map((p) => p.text)
      .join("\n") ?? "";

  console.log("[chat] Received message:", userText);

  if (!userText.trim()) {
    return new Response("No message provided", { status: 400 });
  }

  // Create a custom SSE stream
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const textPartId = `text-${Date.now()}`;
      let started = false;

      const writeEvent = (data: unknown) => {
        const json = JSON.stringify(data);
        console.log("[chat] SSE write:", json);
        controller.enqueue(encoder.encode(`data: ${json}\n\n`));
      };

      console.log("[chat] Starting agent stream...");

      try {
        await runAgent(userText, {
          onTextDelta: (delta) => {
            console.log("[chat] Text delta:", delta);
            if (!started) {
              console.log("[chat] Writing text-start");
              writeEvent({ type: "text-start", id: textPartId });
              started = true;
            }
            writeEvent({ type: "text-delta", id: textPartId, delta });
          },
          onLifecycleEnd: () => {
            console.log("[chat] Lifecycle end, started:", started);
            if (started) {
              writeEvent({ type: "text-end", id: textPartId });
            }
          },
          onError: (err) => {
            console.error("[chat] Agent error:", err);
            if (!started) {
              writeEvent({ type: "text-start", id: textPartId });
              writeEvent({
                type: "text-delta",
                id: textPartId,
                delta: `Error starting agent: ${err.message}`,
              });
              writeEvent({ type: "text-end", id: textPartId });
            }
          },
          onClose: (code) => {
            console.log("[chat] Agent closed with code:", code, "started:", started);
            // If we never started text, emit an empty response
            if (!started) {
              writeEvent({ type: "text-start", id: textPartId });
              writeEvent({
                type: "text-delta",
                id: textPartId,
                delta: "(No response from agent)",
              });
              writeEvent({ type: "text-end", id: textPartId });
            }
          },
        });

        console.log("[chat] Agent stream complete");
      } catch (error) {
        console.error("[chat] Stream error:", error);
        writeEvent({
          type: "error",
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
