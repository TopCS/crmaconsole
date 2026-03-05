import { describe, it, expect, beforeEach, vi } from "vitest";
import { TraceContextManager } from "../../extensions/posthog-analytics/lib/trace-context.js";
import { emitGeneration, emitToolSpan, emitTrace, emitCustomEvent } from "../../extensions/posthog-analytics/lib/event-mappers.js";

function createMockPostHog() {
  return {
    capture: vi.fn(),
    shutdown: vi.fn(),
  } as any;
}

describe("emitGeneration", () => {
  let ph: ReturnType<typeof createMockPostHog>;
  let traceCtx: TraceContextManager;

  beforeEach(() => {
    ph = createMockPostHog();
    traceCtx = new TraceContextManager();
  });

  it("emits $ai_generation with correct model, provider, and trace linkage", () => {
    traceCtx.startTrace("sess-1", "run-1");
    traceCtx.setModel("run-1", "anthropic/claude-4-sonnet");
    traceCtx.setInput("run-1", [{ role: "user", content: "hello" }], false);

    emitGeneration(ph, traceCtx, { runId: "run-1" }, {
      usage: { inputTokens: 10, outputTokens: 20 },
      cost: { totalUsd: 0.001 },
      output: [{ role: "assistant", content: "hi" }],
    }, false);

    expect(ph.capture).toHaveBeenCalledOnce();
    const call = ph.capture.mock.calls[0][0];
    expect(call.event).toBe("$ai_generation");
    expect(call.properties.$ai_model).toBe("anthropic/claude-4-sonnet");
    expect(call.properties.$ai_provider).toBe("anthropic");
    expect(call.properties.$ai_trace_id).toBe(traceCtx.getTrace("run-1")!.traceId);
    expect(call.properties.$ai_session_id).toBe("sess-1");
    expect(call.properties.$ai_input_tokens).toBe(10);
    expect(call.properties.$ai_output_tokens).toBe(20);
    expect(call.properties.$ai_total_cost_usd).toBe(0.001);
    expect(call.properties.$ai_is_error).toBe(false);
  });

  it("redacts input/output when privacy mode is on (enforces privacy boundary)", () => {
    traceCtx.startTrace("s", "r");
    traceCtx.setInput("r", [{ role: "user", content: "sensitive" }], true);

    emitGeneration(ph, traceCtx, { runId: "r" }, {
      output: [{ role: "assistant", content: "also sensitive" }],
    }, true);

    const props = ph.capture.mock.calls[0][0].properties;
    expect(props.$ai_input).toBe("[REDACTED]");
    expect(props.$ai_output_choices).toBe("[REDACTED]");
  });

  it("includes full input/output when privacy mode is off (allows opt-in capture)", () => {
    traceCtx.startTrace("s", "r");
    const input = [{ role: "user", content: "hello" }];
    traceCtx.setInput("r", input, false);

    emitGeneration(ph, traceCtx, { runId: "r" }, {
      output: [{ role: "assistant", content: "world" }],
    }, false);

    const props = ph.capture.mock.calls[0][0].properties;
    expect(props.$ai_input).toEqual(input);
    expect(props.$ai_output_choices).toEqual([{ role: "assistant", content: "world" }]);
  });

  it("captures error details when generation fails (enables error tracking in PostHog)", () => {
    traceCtx.startTrace("s", "r");

    emitGeneration(ph, traceCtx, { runId: "r" }, {
      error: { message: "Rate limit exceeded" },
    }, true);

    const props = ph.capture.mock.calls[0][0].properties;
    expect(props.$ai_is_error).toBe(true);
    expect(props.$ai_error).toBe("Rate limit exceeded");
  });

  it("handles string error (defensive: different error shapes from providers)", () => {
    traceCtx.startTrace("s", "r");
    emitGeneration(ph, traceCtx, { runId: "r" }, { error: "connection timeout" }, true);
    expect(ph.capture.mock.calls[0][0].properties.$ai_error).toBe("connection timeout");
  });

  it("includes tool names in $ai_tools when tools were called (enables tool usage analytics)", () => {
    traceCtx.startTrace("s", "r");
    traceCtx.startToolSpan("r", "web_search", {});
    traceCtx.endToolSpan("r", "web_search", {});
    traceCtx.startToolSpan("r", "exec", {});
    traceCtx.endToolSpan("r", "exec", {});

    emitGeneration(ph, traceCtx, { runId: "r" }, {}, true);

    const props = ph.capture.mock.calls[0][0].properties;
    expect(props.$ai_tools).toEqual(["web_search", "exec"]);
  });

  it("sets $ai_tools to undefined when no tools were called (prevents empty array in PostHog)", () => {
    traceCtx.startTrace("s", "r");
    emitGeneration(ph, traceCtx, { runId: "r" }, {}, true);
    expect(ph.capture.mock.calls[0][0].properties.$ai_tools).toBeUndefined();
  });

  it("silently skips when trace does not exist (prevents crash on stale runId)", () => {
    emitGeneration(ph, traceCtx, { runId: "ghost" }, {}, true);
    expect(ph.capture).not.toHaveBeenCalled();
  });

  it("falls back to event.model when trace has no model set (handles missing before_model_resolve)", () => {
    traceCtx.startTrace("s", "r");
    emitGeneration(ph, traceCtx, { runId: "r" }, { model: "fallback-model" }, true);
    expect(ph.capture.mock.calls[0][0].properties.$ai_model).toBe("fallback-model");
  });

  it("uses 'unknown' when neither trace nor event has model (defensive default)", () => {
    traceCtx.startTrace("s", "r");
    emitGeneration(ph, traceCtx, { runId: "r" }, {}, true);
    expect(ph.capture.mock.calls[0][0].properties.$ai_model).toBe("unknown");
  });

  it("handles snake_case usage keys from some providers (input_tokens vs inputTokens)", () => {
    traceCtx.startTrace("s", "r");
    emitGeneration(ph, traceCtx, { runId: "r" }, {
      usage: { input_tokens: 5, output_tokens: 15 },
    }, true);
    const props = ph.capture.mock.calls[0][0].properties;
    expect(props.$ai_input_tokens).toBe(5);
    expect(props.$ai_output_tokens).toBe(15);
  });

  it("never throws even if PostHog capture throws (prevents gateway crash)", () => {
    ph.capture.mockImplementation(() => { throw new Error("PostHog down"); });
    traceCtx.startTrace("s", "r");
    expect(() => emitGeneration(ph, traceCtx, { runId: "r" }, {}, true)).not.toThrow();
  });
});

describe("emitToolSpan", () => {
  let ph: ReturnType<typeof createMockPostHog>;
  let traceCtx: TraceContextManager;

  beforeEach(() => {
    ph = createMockPostHog();
    traceCtx = new TraceContextManager();
  });

  it("emits $ai_span with correct tool name, timing, and trace linkage", () => {
    traceCtx.startTrace("sess", "r");
    traceCtx.startToolSpan("r", "web_search", { q: "test" });
    traceCtx.endToolSpan("r", "web_search", { results: [] });

    emitToolSpan(ph, traceCtx, "r", {}, false);

    const call = ph.capture.mock.calls[0][0];
    expect(call.event).toBe("$ai_span");
    expect(call.properties.$ai_span_name).toBe("web_search");
    expect(call.properties.$ai_trace_id).toBe(traceCtx.getTrace("r")!.traceId);
    expect(call.properties.$ai_parent_id).toBe(traceCtx.getTrace("r")!.traceId);
    expect(typeof call.properties.$ai_latency).toBe("number");
  });

  it("excludes tool_params and tool_result when privacy mode is on (enforces content redaction)", () => {
    traceCtx.startTrace("s", "r");
    traceCtx.startToolSpan("r", "exec", { cmd: "cat /etc/passwd" });
    traceCtx.endToolSpan("r", "exec", { output: "root:x:0:0:..." });

    emitToolSpan(ph, traceCtx, "r", {}, true);

    const props = ph.capture.mock.calls[0][0].properties;
    expect(props).not.toHaveProperty("tool_params");
    expect(props).not.toHaveProperty("tool_result");
  });

  it("includes tool_params and tool_result with secrets stripped when privacy is off", () => {
    traceCtx.startTrace("s", "r");
    traceCtx.startToolSpan("r", "api_call", { url: "https://api.example.com", apiKey: "secret" });
    traceCtx.endToolSpan("r", "api_call", { status: 200, data: "ok" });

    emitToolSpan(ph, traceCtx, "r", {}, false);

    const props = ph.capture.mock.calls[0][0].properties;
    expect(props.tool_params.url).toBe("https://api.example.com");
    expect(props.tool_params.apiKey).toBe("[REDACTED]");
    expect(props.tool_result.status).toBe(200);
  });

  it("silently skips when no trace or span exists (prevents crash on orphaned events)", () => {
    emitToolSpan(ph, traceCtx, "ghost", {}, false);
    expect(ph.capture).not.toHaveBeenCalled();
  });

  it("never throws even if PostHog capture throws (prevents gateway crash)", () => {
    ph.capture.mockImplementation(() => { throw new Error("boom"); });
    traceCtx.startTrace("s", "r");
    traceCtx.startToolSpan("r", "x", {});
    traceCtx.endToolSpan("r", "x", {});
    expect(() => emitToolSpan(ph, traceCtx, "r", {}, false)).not.toThrow();
  });
});

describe("emitTrace", () => {
  let ph: ReturnType<typeof createMockPostHog>;
  let traceCtx: TraceContextManager;

  beforeEach(() => {
    ph = createMockPostHog();
    traceCtx = new TraceContextManager();
  });

  it("emits $ai_trace with correct trace ID, session ID, and tool count", () => {
    traceCtx.startTrace("sess-1", "r");
    traceCtx.startToolSpan("r", "a", {});
    traceCtx.endToolSpan("r", "a", {});
    traceCtx.startToolSpan("r", "b", {});
    traceCtx.endToolSpan("r", "b", {});

    emitTrace(ph, traceCtx, { runId: "r" });

    const call = ph.capture.mock.calls[0][0];
    expect(call.event).toBe("$ai_trace");
    expect(call.properties.$ai_trace_id).toBe(traceCtx.getTrace("r")!.traceId);
    expect(call.properties.$ai_session_id).toBe("sess-1");
    expect(call.properties.tool_count).toBe(2);
    expect(call.properties.$ai_span_name).toBe("agent_run");
  });

  it("silently skips for non-existent trace", () => {
    emitTrace(ph, traceCtx, { runId: "ghost" });
    expect(ph.capture).not.toHaveBeenCalled();
  });
});

describe("emitCustomEvent", () => {
  it("captures event with $process_person_profile: false (prevents person profile creation)", () => {
    const ph = createMockPostHog();
    emitCustomEvent(ph, "dench_session_start", { session_id: "abc", channel: "telegram" });

    const call = ph.capture.mock.calls[0][0];
    expect(call.event).toBe("dench_session_start");
    expect(call.properties.session_id).toBe("abc");
    expect(call.properties.channel).toBe("telegram");
    expect(call.properties.$process_person_profile).toBe(false);
  });

  it("never throws even if PostHog capture throws", () => {
    const ph = createMockPostHog();
    ph.capture.mockImplementation(() => { throw new Error("boom"); });
    expect(() => emitCustomEvent(ph, "test", {})).not.toThrow();
  });
});
