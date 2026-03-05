import { createPostHogClient, shutdownPostHogClient } from "./lib/posthog-client.js";
import { TraceContextManager } from "./lib/trace-context.js";
import { emitGeneration, emitToolSpan, emitTrace, emitCustomEvent } from "./lib/event-mappers.js";
import { readPrivacyMode } from "./lib/privacy.js";
import type { PluginConfig } from "./lib/types.js";

export const id = "posthog-analytics";

export default function register(api: any) {
  const config: PluginConfig | undefined =
    api.config?.plugins?.entries?.["posthog-analytics"]?.config;

  if (!config?.apiKey) return;
  if (config.enabled === false) return;

  const ph = createPostHogClient(config.apiKey, config.host);
  const traceCtx = new TraceContextManager();

  const getPrivacyMode = () => readPrivacyMode(api.config);

  api.on(
    "before_model_resolve",
    (event: any, ctx: any) => {
      traceCtx.startTrace(ctx.sessionId ?? ctx.runId, ctx.runId);
      if (event.modelOverride) {
        traceCtx.setModel(ctx.runId, event.modelOverride);
      }
    },
    { priority: -10 },
  );

  api.on(
    "before_prompt_build",
    (_event: any, ctx: any) => {
      if (ctx.messages) {
        traceCtx.setInput(ctx.runId, ctx.messages, getPrivacyMode());
      }
    },
    { priority: -10 },
  );

  api.on(
    "before_tool_call",
    (event: any, ctx: any) => {
      traceCtx.startToolSpan(ctx.runId, event.toolName, event.params);
    },
    { priority: -10 },
  );

  api.on(
    "after_tool_call",
    (event: any, ctx: any) => {
      traceCtx.endToolSpan(ctx.runId, event.toolName, event.result);
      emitToolSpan(ph, traceCtx, ctx.runId, event, getPrivacyMode());
    },
    { priority: -10 },
  );

  api.on(
    "agent_end",
    (event: any, ctx: any) => {
      emitGeneration(ph, traceCtx, ctx, event, getPrivacyMode());
      emitTrace(ph, traceCtx, ctx);
      emitCustomEvent(ph, "dench_turn_completed", {
        session_id: ctx.sessionId,
        run_id: ctx.runId,
        model: traceCtx.getModel(ctx.runId),
      });
      traceCtx.endTrace(ctx.runId);
    },
    { priority: -10 },
  );

  api.on(
    "message_received",
    (event: any, ctx: any) => {
      emitCustomEvent(ph, "dench_message_received", {
        channel: ctx.channel,
        session_id: ctx.sessionId,
        has_attachments: Boolean(event.attachments?.length),
      });
    },
    { priority: -10 },
  );

  api.on(
    "session_start",
    (_event: any, ctx: any) => {
      emitCustomEvent(ph, "dench_session_start", {
        session_id: ctx.sessionId,
        channel: ctx.channel,
      });
    },
    { priority: -10 },
  );

  api.on(
    "session_end",
    (_event: any, ctx: any) => {
      emitCustomEvent(ph, "dench_session_end", {
        session_id: ctx.sessionId,
        channel: ctx.channel,
      });
    },
    { priority: -10 },
  );

  api.registerService({
    id: "posthog-analytics",
    start: () => api.logger.info("[posthog-analytics] service started"),
    stop: () => shutdownPostHogClient(ph),
  });
}
