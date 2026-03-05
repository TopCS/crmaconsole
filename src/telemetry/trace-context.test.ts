import { describe, it, expect, beforeEach } from "vitest";
import { TraceContextManager } from "../../extensions/posthog-analytics/lib/trace-context.js";

describe("TraceContextManager", () => {
  let ctx: TraceContextManager;

  beforeEach(() => {
    ctx = new TraceContextManager();
  });

  // ── Trace lifecycle ──

  it("generates a unique UUID traceId for each trace (ensures PostHog trace grouping)", () => {
    ctx.startTrace("session-1", "run-1");
    ctx.startTrace("session-1", "run-2");
    const t1 = ctx.getTrace("run-1")!;
    const t2 = ctx.getTrace("run-2")!;
    expect(t1.traceId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(t1.traceId).not.toBe(t2.traceId);
  });

  it("records sessionId and runId on the trace (ensures trace-to-session linkage)", () => {
    ctx.startTrace("sess-abc", "run-xyz");
    const trace = ctx.getTrace("run-xyz")!;
    expect(trace.sessionId).toBe("sess-abc");
    expect(trace.runId).toBe("run-xyz");
  });

  it("records startedAt timestamp on trace creation (enables latency calculation)", () => {
    const before = Date.now();
    ctx.startTrace("s", "r");
    const after = Date.now();
    const trace = ctx.getTrace("r")!;
    expect(trace.startedAt).toBeGreaterThanOrEqual(before);
    expect(trace.startedAt).toBeLessThanOrEqual(after);
  });

  it("endTrace sets endedAt on the trace (enables accurate latency measurement)", () => {
    ctx.startTrace("s", "r");
    ctx.endTrace("r");
    const trace = ctx.getTrace("r")!;
    expect(trace.endedAt).toBeDefined();
    expect(trace.endedAt!).toBeGreaterThanOrEqual(trace.startedAt);
  });

  it("returns undefined for non-existent runId (defensive: no crash on stale references)", () => {
    expect(ctx.getTrace("nonexistent")).toBeUndefined();
    expect(ctx.getModel("nonexistent")).toBeUndefined();
    expect(ctx.getLastToolSpan("nonexistent")).toBeUndefined();
  });

  // ── Model resolution ──

  it("extracts provider from model string with slash separator (enables PostHog $ai_provider)", () => {
    ctx.startTrace("s", "r");
    ctx.setModel("r", "anthropic/claude-4-sonnet");
    expect(ctx.getTrace("r")!.model).toBe("anthropic/claude-4-sonnet");
    expect(ctx.getTrace("r")!.provider).toBe("anthropic");
  });

  it("does not set provider for models without a slash (e.g. 'gpt-4o')", () => {
    ctx.startTrace("s", "r");
    ctx.setModel("r", "gpt-4o");
    expect(ctx.getTrace("r")!.model).toBe("gpt-4o");
    expect(ctx.getTrace("r")!.provider).toBeUndefined();
  });

  it("handles multi-segment provider paths like vercel-ai-gateway/anthropic/claude-4", () => {
    ctx.startTrace("s", "r");
    ctx.setModel("r", "vercel-ai-gateway/anthropic/claude-4");
    expect(ctx.getTrace("r")!.provider).toBe("vercel-ai-gateway");
  });

  it("ignores setModel for non-existent run (no crash on race between model resolve and cleanup)", () => {
    ctx.setModel("ghost-run", "gpt-4o");
    expect(ctx.getModel("ghost-run")).toBeUndefined();
  });

  // ── Input capture with privacy ──

  it("redacts message content when privacy mode is on (prevents content leakage in PostHog)", () => {
    ctx.startTrace("s", "r");
    ctx.setInput("r", [
      { role: "user", content: "My SSN is 123-45-6789" },
      { role: "assistant", content: "I should not store that." },
    ], true);
    const input = ctx.getTrace("r")!.input as Array<Record<string, unknown>>;
    expect(input[0].content).toBe("[REDACTED]");
    expect(input[1].content).toBe("[REDACTED]");
    expect(input[0].role).toBe("user");
  });

  it("preserves message content when privacy mode is off (allows opt-in content capture)", () => {
    ctx.startTrace("s", "r");
    ctx.setInput("r", [{ role: "user", content: "Hello world" }], false);
    const input = ctx.getTrace("r")!.input as Array<Record<string, unknown>>;
    expect(input[0].content).toBe("Hello world");
  });

  it("ignores setInput for non-existent run (no crash on stale context)", () => {
    ctx.setInput("ghost", [{ role: "user", content: "test" }], true);
    expect(ctx.getTrace("ghost")).toBeUndefined();
  });

  // ── Tool span lifecycle ──

  it("tracks tool span start/end with timing and error detection (enables $ai_span events)", () => {
    ctx.startTrace("s", "r");
    const before = Date.now();
    ctx.startToolSpan("r", "web_search", { query: "test" });
    const span = ctx.getLastToolSpan("r")!;
    expect(span.toolName).toBe("web_search");
    expect(span.startedAt).toBeGreaterThanOrEqual(before);
    expect(span.endedAt).toBeUndefined();
    expect(span.spanId).toMatch(/^[0-9a-f]{8}-/);

    ctx.endToolSpan("r", "web_search", { results: ["a", "b"] });
    expect(span.endedAt).toBeDefined();
    expect(span.isError).toBe(false);
  });

  it("marks tool span as error when result contains an 'error' key (enables $ai_is_error flag)", () => {
    ctx.startTrace("s", "r");
    ctx.startToolSpan("r", "exec", { cmd: "rm -rf /" });
    ctx.endToolSpan("r", "exec", { error: "permission denied" });
    expect(ctx.getLastToolSpan("r")!.isError).toBe(true);
  });

  it("does not mark as error for results without error key (prevents false error flags)", () => {
    ctx.startTrace("s", "r");
    ctx.startToolSpan("r", "read_file", { path: "/tmp/x" });
    ctx.endToolSpan("r", "read_file", { content: "file data" });
    expect(ctx.getLastToolSpan("r")!.isError).toBe(false);
  });

  it("handles multiple tool spans in order (enables correct span-to-trace nesting)", () => {
    ctx.startTrace("s", "r");
    ctx.startToolSpan("r", "search", { q: "a" });
    ctx.endToolSpan("r", "search", { ok: true });
    ctx.startToolSpan("r", "read", { path: "/tmp" });
    ctx.endToolSpan("r", "read", { ok: true });

    const trace = ctx.getTrace("r")!;
    expect(trace.toolSpans).toHaveLength(2);
    expect(trace.toolSpans[0].toolName).toBe("search");
    expect(trace.toolSpans[1].toolName).toBe("read");
    expect(ctx.getLastToolSpan("r")!.toolName).toBe("read");
  });

  it("matches end to the most recent unfinished span of the same tool name (prevents mismatched close)", () => {
    ctx.startTrace("s", "r");
    ctx.startToolSpan("r", "exec", { cmd: "ls" });
    ctx.endToolSpan("r", "exec", { output: "file1" });
    ctx.startToolSpan("r", "exec", { cmd: "pwd" });
    ctx.endToolSpan("r", "exec", { output: "/home" });

    const spans = ctx.getTrace("r")!.toolSpans;
    expect(spans).toHaveLength(2);
    expect(spans[0].endedAt).toBeDefined();
    expect(spans[1].endedAt).toBeDefined();
  });

  it("ignores startToolSpan/endToolSpan for non-existent run (no crash on orphaned tool events)", () => {
    ctx.startToolSpan("ghost", "search", {});
    ctx.endToolSpan("ghost", "search", {});
    expect(ctx.getLastToolSpan("ghost")).toBeUndefined();
  });

  it("getLastToolSpan returns undefined when no spans exist (defensive edge case)", () => {
    ctx.startTrace("s", "r");
    expect(ctx.getLastToolSpan("r")).toBeUndefined();
  });

  // ── Concurrent runs ──

  it("isolates traces across concurrent runs (prevents cross-run data contamination)", () => {
    ctx.startTrace("s1", "run-a");
    ctx.startTrace("s2", "run-b");
    ctx.setModel("run-a", "gpt-4o");
    ctx.setModel("run-b", "claude-4-sonnet");
    ctx.startToolSpan("run-a", "search", {});
    ctx.startToolSpan("run-b", "exec", {});

    expect(ctx.getModel("run-a")).toBe("gpt-4o");
    expect(ctx.getModel("run-b")).toBe("claude-4-sonnet");
    expect(ctx.getTrace("run-a")!.toolSpans).toHaveLength(1);
    expect(ctx.getTrace("run-a")!.toolSpans[0].toolName).toBe("search");
    expect(ctx.getTrace("run-b")!.toolSpans[0].toolName).toBe("exec");
  });
});
