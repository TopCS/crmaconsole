import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { join } from "node:path";

export type AgentEvent = {
  event: string;
  runId?: string;
  stream?: string;
  data?: Record<string, unknown>;
  seq?: number;
  ts?: number;
  sessionKey?: string;
  status?: string;
  result?: {
    payloads?: Array<{ text?: string; mediaUrl?: string | null }>;
    meta?: Record<string, unknown>;
  };
};

export type AgentCallback = {
  onTextDelta: (delta: string) => void;
  onLifecycleEnd: () => void;
  onError: (error: Error) => void;
  onClose: (code: number | null) => void;
};

/**
 * Spawn the openclaw agent and stream its output
 */
export async function runAgent(message: string, callback: AgentCallback): Promise<void> {
  // Get repo root - construct path dynamically at runtime
  const cwd = process.cwd();
  const root = cwd.endsWith(join("apps", "web")) ? join(cwd, "..", "..") : cwd;

  // Construct script path at runtime to avoid static analysis
  const pathParts = ["scripts", "run-node.mjs"];
  const scriptPath = join(root, ...pathParts);

  return new Promise<void>((resolve, reject) => {
    const child = spawn(
      "node",
      [scriptPath, "agent", "--agent", "main", "--message", message, "--stream-json"],
      {
        cwd: root,
        env: { ...process.env },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    const rl = createInterface({ input: child.stdout });

    rl.on("line", (line: string) => {
      if (!line.trim()) return;

      let event: AgentEvent;
      try {
        event = JSON.parse(line) as AgentEvent;
      } catch (err) {
        console.log("[agent-runner] Non-JSON line:", line);
        return; // skip non-JSON lines
      }

      console.log("[agent-runner] Event:", event.event, event.stream, event.data);

      // Handle assistant text deltas
      if (event.event === "agent" && event.stream === "assistant") {
        const delta = typeof event.data?.delta === "string" ? event.data.delta : undefined;
        if (delta) {
          console.log("[agent-runner] Delta:", delta);
          callback.onTextDelta(delta);
        }
      }

      // Handle lifecycle end
      if (
        event.event === "agent" &&
        event.stream === "lifecycle" &&
        event.data?.phase === "end"
      ) {
        console.log("[agent-runner] Lifecycle end");
        callback.onLifecycleEnd();
      }
    });

    child.on("close", (code) => {
      callback.onClose(code);
      resolve();
    });

    child.on("error", (err) => {
      callback.onError(err);
      resolve();
    });

    // Log stderr for debugging
    child.stderr?.on("data", (chunk: Buffer) => {
      console.error("[openclaw stderr]", chunk.toString());
    });
  });
}
