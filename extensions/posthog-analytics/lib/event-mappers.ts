import { createHash } from "node:crypto";
import os from "node:os";
import type { PostHogClient } from "./posthog-client.js";
import type { TraceContextManager } from "./trace-context.js";
import { sanitizeForCapture, stripSecrets } from "./privacy.js";

function getAnonymousId(): string {
  try {
    const raw = `${os.hostname()}:${os.userInfo().username}`;
    return createHash("sha256").update(raw).digest("hex").slice(0, 16);
  } catch {
    return "unknown";
  }
}

/**
 * Emit a `$ai_generation` event from the agent_end hook data.
 */
export function emitGeneration(
  ph: PostHogClient,
  traceCtx: TraceContextManager,
  ctx: any,
  event: any,
  privacyMode: boolean,
): void {
  try {
    const trace = traceCtx.getTrace(ctx.runId);
    if (!trace) return;

    const latency = trace.startedAt
      ? (Date.now() - trace.startedAt) / 1_000
      : undefined;

    const toolNames = trace.toolSpans.map((s) => s.toolName);

    const properties: Record<string, unknown> = {
      $ai_trace_id: trace.traceId,
      $ai_session_id: trace.sessionId,
      $ai_model: trace.model ?? event.model ?? "unknown",
      $ai_provider: trace.provider ?? event.provider,
      $ai_latency: latency,
      $ai_tools: toolNames.length > 0 ? toolNames : undefined,
      $ai_stream: event.stream,
      $ai_temperature: event.temperature,
      $ai_is_error: Boolean(event.error),
    };

    if (event.usage) {
      properties.$ai_input_tokens = event.usage.inputTokens ?? event.usage.input_tokens;
      properties.$ai_output_tokens = event.usage.outputTokens ?? event.usage.output_tokens;
    }

    if (event.cost) {
      properties.$ai_total_cost_usd = event.cost.totalUsd ?? event.cost.total_usd;
    }

    properties.$ai_input = sanitizeForCapture(trace.input, privacyMode);
    properties.$ai_output_choices = sanitizeForCapture(
      event.output ?? event.messages,
      privacyMode,
    );

    if (event.error) {
      properties.$ai_error = typeof event.error === "string"
        ? event.error
        : event.error?.message ?? String(event.error);
    }

    ph.capture({
      distinctId: getAnonymousId(),
      event: "$ai_generation",
      properties,
    });
  } catch {
    // Never crash the gateway for telemetry failures.
  }
}

/**
 * Emit a `$ai_span` event for a completed tool call.
 */
export function emitToolSpan(
  ph: PostHogClient,
  traceCtx: TraceContextManager,
  runId: string,
  event: any,
  privacyMode: boolean,
): void {
  try {
    const trace = traceCtx.getTrace(runId);
    const span = traceCtx.getLastToolSpan(runId);
    if (!trace || !span) return;

    const latency = span.startedAt && span.endedAt
      ? (span.endedAt - span.startedAt) / 1_000
      : undefined;

    const properties: Record<string, unknown> = {
      $ai_trace_id: trace.traceId,
      $ai_session_id: trace.sessionId,
      $ai_span_id: span.spanId,
      $ai_span_name: span.toolName,
      $ai_parent_id: trace.traceId,
      $ai_latency: latency,
      $ai_is_error: span.isError ?? Boolean(event.error),
    };

    if (!privacyMode) {
      properties.tool_params = stripSecrets(span.params);
      properties.tool_result = stripSecrets(span.result);
    }

    ph.capture({
      distinctId: getAnonymousId(),
      event: "$ai_span",
      properties,
    });
  } catch {
    // Fail silently.
  }
}

/**
 * Emit a `$ai_trace` event for the completed agent run.
 */
export function emitTrace(
  ph: PostHogClient,
  traceCtx: TraceContextManager,
  ctx: any,
): void {
  try {
    const trace = traceCtx.getTrace(ctx.runId);
    if (!trace) return;

    const latency = trace.startedAt
      ? (Date.now() - trace.startedAt) / 1_000
      : undefined;

    ph.capture({
      distinctId: getAnonymousId(),
      event: "$ai_trace",
      properties: {
        $ai_trace_id: trace.traceId,
        $ai_session_id: trace.sessionId,
        $ai_latency: latency,
        $ai_span_name: "agent_run",
        tool_count: trace.toolSpans.length,
      },
    });
  } catch {
    // Fail silently.
  }
}

/**
 * Emit a custom DenchClaw event (not a PostHog $ai_* event).
 */
export function emitCustomEvent(
  ph: PostHogClient,
  eventName: string,
  properties?: Record<string, unknown>,
): void {
  try {
    ph.capture({
      distinctId: getAnonymousId(),
      event: eventName,
      properties: {
        ...properties,
        $process_person_profile: false,
      },
    });
  } catch {
    // Fail silently.
  }
}
