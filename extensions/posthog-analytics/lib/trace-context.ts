import { randomUUID } from "node:crypto";
import { redactMessages } from "./privacy.js";
import type { TraceEntry, ToolSpanEntry } from "./types.js";

/**
 * Tracks in-flight trace and span state per agent run.
 * Each `runId` maps to one trace containing zero or more tool spans.
 */
export class TraceContextManager {
  private traces = new Map<string, TraceEntry>();

  startTrace(sessionId: string, runId: string): void {
    this.traces.set(runId, {
      traceId: randomUUID(),
      sessionId,
      runId,
      startedAt: Date.now(),
      toolSpans: [],
    });
  }

  setModel(runId: string, model: string): void {
    const t = this.traces.get(runId);
    if (!t) return;
    t.model = model;
    const slashIdx = model.indexOf("/");
    if (slashIdx > 0) {
      t.provider = model.slice(0, slashIdx);
    }
  }

  setInput(runId: string, messages: unknown, privacyMode: boolean): void {
    const t = this.traces.get(runId);
    if (!t) return;
    t.input = privacyMode ? redactMessages(messages) : messages;
  }

  startToolSpan(runId: string, toolName: string, params?: unknown): void {
    const t = this.traces.get(runId);
    if (!t) return;
    t.toolSpans.push({
      toolName,
      spanId: randomUUID(),
      startedAt: Date.now(),
      params,
    });
  }

  endToolSpan(runId: string, toolName: string, result?: unknown): void {
    const t = this.traces.get(runId);
    if (!t) return;
    for (let i = t.toolSpans.length - 1; i >= 0; i--) {
      const span = t.toolSpans[i];
      if (span.toolName === toolName && !span.endedAt) {
        span.endedAt = Date.now();
        span.result = result;
        span.isError =
          result != null &&
          typeof result === "object" &&
          "error" in (result as Record<string, unknown>);
        break;
      }
    }
  }

  getTrace(runId: string): TraceEntry | undefined {
    return this.traces.get(runId);
  }

  getModel(runId: string): string | undefined {
    return this.traces.get(runId)?.model;
  }

  getLastToolSpan(runId: string): ToolSpanEntry | undefined {
    const t = this.traces.get(runId);
    if (!t || t.toolSpans.length === 0) return undefined;
    return t.toolSpans[t.toolSpans.length - 1];
  }

  endTrace(runId: string): void {
    const t = this.traces.get(runId);
    if (t) {
      t.endedAt = Date.now();
    }
    // Clean up after a short delay to allow final event emission.
    setTimeout(() => this.traces.delete(runId), 5_000);
  }
}
