// extensions/shared/crm-a-auth.ts
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
var AUTH_PROFILES_REL = path.join("agents", "main", "agent", "auth-profiles.json");
function readCrmAAuthProfileKey() {
  const stateDir = process.env.OPENCLAW_STATE_DIR;
  if (stateDir) {
    const key = readKeyFromAuthProfiles(path.join(stateDir, AUTH_PROFILES_REL));
    if (key) return key;
  }
  return envFallback();
}
function readKeyFromAuthProfiles(authPath) {
  try {
    if (!existsSync(authPath)) return void 0;
    const raw = JSON.parse(readFileSync(authPath, "utf-8"));
    const key = raw?.profiles?.["crm-a-cloud:default"]?.key;
    return typeof key === "string" && key.trim() ? key.trim() : void 0;
  } catch {
    return void 0;
  }
}
function envFallback() {
  return process.env.CRM_A_CLOUD_API_KEY?.trim() || process.env.CRM_A_API_KEY?.trim() || void 0;
}

// extensions/crm-a-ai-gateway/composio-bridge.ts
var CRM_A_EXECUTE_INTEGRATIONS_NAME = "crm_a_execute_integrations";
var CRM_A_INTEGRATIONS_DISPLAY_NAME = "Crm-A Integrations";
var CRM_A_EXECUTE_INTEGRATIONS_PARAMETERS = {
  type: "object",
  additionalProperties: false,
  properties: {
    tool_slug: {
      type: "string",
      description: "Exact tool slug returned by crm_a_search_integrations, for example GMAIL_FETCH_EMAILS or YOUTUBE_LIST_USER_SUBSCRIPTIONS."
    },
    arguments: {
      type: "object",
      additionalProperties: true,
      description: "JSON arguments object matching the tool's input_schema from the search results.",
      properties: {}
    },
    connected_account_id: {
      type: "string",
      description: "Optional connected account id. Required only when multiple accounts are connected for the same toolkit. The gateway auto-selects when only one account exists."
    }
  },
  required: ["tool_slug"]
};
function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : void 0;
}
function readString(value) {
  return typeof value === "string" ? value : void 0;
}
function jsonResult(payload, details) {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    details: details ?? payload
  };
}
function resolveGatewayBaseUrl(api, fallbackGatewayUrl) {
  const plugins = asRecord(asRecord(api?.config)?.plugins)?.entries;
  const crmAGateway = asRecord(asRecord(plugins)?.["crm-a-ai-gateway"]);
  const gwConfig = asRecord(crmAGateway?.config);
  const configuredUrl = readString(gwConfig?.gatewayUrl);
  return (configuredUrl ?? fallbackGatewayUrl).replace(/\/$/, "");
}
function resolveComposioUserId() {
  return process.env.COMPOSIO_USER_ID?.trim() || "crm-a-console";
}
function resolveApiKey() {
  return readCrmAAuthProfileKey() ?? void 0;
}
function createCrmAExecuteIntegrationsTool(params) {
  return {
    name: CRM_A_EXECUTE_INTEGRATIONS_NAME,
    label: `${CRM_A_INTEGRATIONS_DISPLAY_NAME} Execute`,
    description: `Execute a ${CRM_A_INTEGRATIONS_DISPLAY_NAME.toLowerCase()} tool by its slug. Pass the tool_slug from crm_a_search_integrations and the arguments matching its input_schema. The gateway handles authentication and account selection.`,
    parameters: CRM_A_EXECUTE_INTEGRATIONS_PARAMETERS,
    async execute(_toolCallId, input) {
      const payload = asRecord(input) ?? {};
      const toolSlug = readString(payload.tool_slug)?.trim();
      const connectedAccountId = readString(payload.connected_account_id)?.trim();
      const toolArgs = asRecord(payload.arguments) ?? {};
      if (!toolSlug) {
        return jsonResult({
          error: "The `tool_slug` field is required. Use crm_a_search_integrations to find available tools first."
        });
      }
      try {
        if (params.directApiKey) {
          const res2 = await fetch(
            `https://backend.composio.dev/api/v3.1/tools/execute/${encodeURIComponent(toolSlug)}`,
            {
              method: "POST",
              headers: {
                "content-type": "application/json",
                accept: "application/json",
                "x-api-key": params.directApiKey
              },
              body: JSON.stringify({
                arguments: toolArgs,
                // Composio v3.1 requires user_id even when an explicit
                // connected_account_id is provided ("User ID is required
                // with connected account") — always send the connect-time id.
                user_id: resolveComposioUserId(),
                ...connectedAccountId ? { connected_account_id: connectedAccountId } : {}
              })
            }
          );
          const text2 = await res2.text();
          let parsed2;
          try {
            parsed2 = JSON.parse(text2);
          } catch {
            parsed2 = void 0;
          }
          if (!res2.ok) {
            return jsonResult({
              error: `Composio ${toolSlug} failed: HTTP ${res2.status}${text2 ? ` \u2014 ${text2.slice(0, 240)}` : ""}`
            });
          }
          if (parsed2?.successful === false || readString(parsed2?.error)) {
            const upstreamError = readString(parsed2?.error) ?? "unknown error";
            if (readString(asRecord(parsed2?.error)?.slug) === "ActionExecute_ConnectedAccountEntityIdMismatch") {
              return jsonResult({
                error: `Composio ${toolSlug} failed: the connected account belongs to a different Composio user.`,
                guidance: "Ask the user to reconnect this integration (the new connection will bind to the current user), or unset COMPOSIO_USER_ID to use the legacy user. Then retry.",
                not_connected: true
              });
            }
            return jsonResult({
              error: `Composio ${toolSlug} failed: ${upstreamError}`
            });
          }
          return jsonResult(parsed2?.data ?? parsed2 ?? {});
        }
        const res = await fetch(`${params.gatewayBaseUrl}/v1/composio/tools/execute`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
            ...params.authorization ? { authorization: params.authorization } : {}
          },
          body: JSON.stringify({
            tool_slug: toolSlug,
            arguments: toolArgs,
            ...connectedAccountId ? { connected_account_id: connectedAccountId } : {}
          })
        });
        const text = await res.text();
        let parsed;
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = void 0;
        }
        if (!res.ok) {
          const errorCode = readString(asRecord(parsed?.error)?.code) ?? readString(parsed?.code);
          const errorMessage = readString(asRecord(parsed?.error)?.message) ?? readString(parsed?.error) ?? text;
          if (errorCode === "composio_account_selection_required") {
            return jsonResult(
              {
                error: errorMessage,
                account_selection_required: true,
                instruction: "Ask the user which connected account to use and pass its connected_account_id."
              },
              { status: "error", errorCode, tool_slug: toolSlug }
            );
          }
          if (errorCode === "composio_not_connected") {
            return jsonResult(
              { error: errorMessage, not_connected: true },
              { status: "error", errorCode, tool_slug: toolSlug }
            );
          }
          return jsonResult(
            {
              error: `${CRM_A_INTEGRATIONS_DISPLAY_NAME} tool ${toolSlug} failed (HTTP ${res.status}).`,
              detail: parsed ?? (text || void 0)
            },
            { status: "error", tool_slug: toolSlug }
          );
        }
        const data = parsed?.data;
        const error = readString(parsed?.error);
        const contentPayload = error ? { error, data } : data ?? parsed ?? {};
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(contentPayload, null, 2)
            }
          ],
          details: {
            crmAIntegrations: true,
            tool_slug: toolSlug,
            ...parsed?.log_id ? { logId: parsed.log_id } : {},
            ...data !== void 0 ? { structuredContent: data } : {},
            ...error ? { status: "error", error } : {},
            ...connectedAccountId ? { connectedAccountId } : {}
          }
        };
      } catch (error) {
        return jsonResult(
          {
            error: `${CRM_A_INTEGRATIONS_DISPLAY_NAME} tool ${toolSlug} failed.`,
            detail: error instanceof Error ? error.message : String(error)
          },
          { status: "error", tool_slug: toolSlug }
        );
      }
    }
  };
}
function stripRuntimeComposioServer(api) {
  const rootConfig = asRecord(api?.config);
  const mcp = asRecord(rootConfig?.mcp);
  const servers = asRecord(mcp?.servers);
  if (!rootConfig || !mcp || !servers) return;
  if (servers.composio) {
    delete servers.composio;
    if (Object.keys(servers).length === 0) delete mcp.servers;
    if (Object.keys(mcp).length === 0) delete rootConfig.mcp;
  }
}
function registerCrmAIntegrationsBridge(api, fallbackGatewayUrl) {
  stripRuntimeComposioServer(api);
  const directApiKey = process.env.COMPOSIO_API_KEY?.trim();
  if (directApiKey) {
    api.registerTool(createCrmAExecuteIntegrationsTool({ directApiKey }), {
      name: CRM_A_EXECUTE_INTEGRATIONS_NAME,
      optional: true
    });
    api.logger?.info?.(
      `[crm-a-ai-gateway] registered ${CRM_A_EXECUTE_INTEGRATIONS_NAME} bridge tool (direct Composio)`
    );
    return;
  }
  const gatewayBaseUrl = resolveGatewayBaseUrl(api, fallbackGatewayUrl);
  const apiKey = resolveApiKey();
  if (!apiKey) {
    return;
  }
  const tool = createCrmAExecuteIntegrationsTool({
    gatewayBaseUrl,
    authorization: `Bearer ${apiKey}`
  });
  api.registerTool(tool, {
    name: CRM_A_EXECUTE_INTEGRATIONS_NAME,
    optional: true
  });
  api.logger?.info?.(
    `[crm-a-ai-gateway] registered ${CRM_A_EXECUTE_INTEGRATIONS_NAME} bridge tool`
  );
}

// extensions/crm-a-ai-gateway/models.ts
var DEFAULT_CRM_A_CLOUD_GATEWAY_URL = "https://gateway.merseoriginals.com";
function asRecord2(value) {
  return value && typeof value === "object" ? value : void 0;
}
function readString2(input, ...keys) {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return void 0;
}
function readNumber(input, ...keys) {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim().length > 0) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return void 0;
}
function readBoolean(input, ...keys) {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "boolean") {
      return value;
    }
  }
  return void 0;
}
function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}
function normalizeInputKinds(input, supportsImages) {
  if (!Array.isArray(input)) {
    return supportsImages ? ["text", "image"] : ["text"];
  }
  const kinds = /* @__PURE__ */ new Set();
  for (const value of input) {
    if (value === "text" || value === "image") {
      kinds.add(value);
    }
  }
  if (!kinds.has("text")) {
    kinds.add("text");
  }
  if (supportsImages) {
    kinds.add("image");
  }
  return [...kinds];
}
function stripTrailingSlashes(url) {
  let end = url.length;
  while (end > 0 && url.charCodeAt(end - 1) === 47) {
    end -= 1;
  }
  return end === url.length ? url : url.slice(0, end);
}
function normalizeCrmAGatewayUrl(value) {
  const raw = (value || DEFAULT_CRM_A_CLOUD_GATEWAY_URL).trim();
  const withProtocol = raw.startsWith("http://") || raw.startsWith("https://") ? raw : `https://${raw}`;
  let base = stripTrailingSlashes(withProtocol);
  if (base.endsWith("/v1")) {
    base = stripTrailingSlashes(base.slice(0, -3));
  }
  return base;
}
function buildCrmAGatewayApiBaseUrl(gatewayUrl) {
  return `${normalizeCrmAGatewayUrl(gatewayUrl)}/v1`;
}
function buildCrmAGatewayCatalogUrl(gatewayUrl) {
  return `${normalizeCrmAGatewayUrl(gatewayUrl)}/v1/public/models`;
}
var RECOMMENDED_CRM_A_CLOUD_MODEL_ID = "claude-sonnet-4.6";
var FALLBACK_CRM_A_CLOUD_MODELS = [
  {
    id: "kimi-k2.5",
    stableId: "moonshotai.kimi-k2.5",
    displayName: "Kimi K2.5",
    provider: "moonshot",
    transportProvider: "bedrock",
    api: "openai-responses",
    input: ["text", "image"],
    reasoning: true,
    contextWindow: 262e3,
    maxTokens: 64e3,
    supportsStreaming: true,
    supportsImages: true,
    supportsResponses: true,
    supportsReasoning: true,
    cost: {
      input: 0.81,
      output: 4.05,
      cacheRead: 0,
      cacheWrite: 0
    }
  },
  {
    id: "claude-opus-4.6",
    stableId: "anthropic.claude-opus-4-6-v1",
    displayName: "Claude Opus 4.6",
    provider: "anthropic",
    transportProvider: "bedrock",
    api: "openai-responses",
    input: ["text", "image"],
    reasoning: true,
    contextWindow: 971e3,
    maxTokens: 128e3,
    supportsStreaming: true,
    supportsImages: true,
    supportsResponses: true,
    supportsReasoning: true,
    cost: {
      input: 6.75,
      output: 33.75,
      cacheRead: 0.675,
      cacheWrite: 8.4375
    }
  },
  {
    id: "gpt-5.4",
    stableId: "gpt-5.4",
    displayName: "GPT-5.4",
    provider: "openai",
    transportProvider: "openai",
    api: "openai-responses",
    input: ["text", "image"],
    reasoning: true,
    contextWindow: 971e3,
    maxTokens: 128e3,
    supportsStreaming: true,
    supportsImages: true,
    supportsResponses: true,
    supportsReasoning: true,
    cost: {
      input: 3.375,
      output: 20.25,
      cacheRead: 0.3375,
      cacheWrite: 0
    }
  },
  {
    id: "claude-sonnet-4.6",
    stableId: "anthropic.claude-sonnet-4-6-v1",
    displayName: "Claude Sonnet 4.6",
    provider: "anthropic",
    transportProvider: "bedrock",
    api: "openai-responses",
    input: ["text", "image"],
    reasoning: true,
    contextWindow: 971e3,
    maxTokens: 64e3,
    supportsStreaming: true,
    supportsImages: true,
    supportsResponses: true,
    supportsReasoning: true,
    cost: {
      input: 4.05,
      output: 20.25,
      cacheRead: 0.405,
      cacheWrite: 5.0625
    }
  }
];
function cloneFallbackCrmACloudModels() {
  return FALLBACK_CRM_A_CLOUD_MODELS.map((model) => ({
    ...model,
    input: [...model.input],
    cost: { ...model.cost }
  }));
}
function normalizeCrmACloudCatalogModel(input) {
  const record = asRecord2(input);
  if (!record) {
    return null;
  }
  const publicId = readString2(record, "id", "publicId", "public_id");
  const stableId = readString2(record, "stableId", "stable_id") || publicId;
  const displayName = readString2(record, "name", "displayName", "display_name");
  const provider = readString2(record, "provider");
  const transportProvider = readString2(record, "transportProvider", "transport_provider");
  if (!publicId || !stableId || !displayName || !isNonEmptyString(provider) || !isNonEmptyString(transportProvider)) {
    return null;
  }
  const supportsImages = readBoolean(record, "supportsImages", "supports_images") ?? false;
  const supportsStreaming = readBoolean(record, "supportsStreaming", "supports_streaming") ?? true;
  const supportsResponses = readBoolean(record, "supportsResponses", "supports_responses") ?? true;
  const supportsReasoning = readBoolean(record, "supportsReasoning", "supports_reasoning") ?? readBoolean(record, "reasoning") ?? false;
  const contextWindow = readNumber(record, "contextWindow", "context_window") ?? 2e5;
  const maxTokens = readNumber(record, "maxTokens", "max_tokens", "maxOutputTokens", "max_output_tokens") ?? 64e3;
  const costRecord = asRecord2(record.cost) ?? {};
  const inputCost = readNumber(costRecord, "input") ?? 0;
  const outputCost = readNumber(costRecord, "output") ?? 0;
  const cacheRead = readNumber(costRecord, "cacheRead", "cache_read") ?? 0;
  const cacheWrite = readNumber(costRecord, "cacheWrite", "cache_write") ?? 0;
  return {
    id: publicId,
    stableId,
    displayName,
    provider,
    transportProvider,
    api: record.api === "openai-completions" ? "openai-completions" : "openai-responses",
    input: normalizeInputKinds(record.input, supportsImages),
    reasoning: supportsReasoning,
    contextWindow,
    maxTokens,
    supportsStreaming,
    supportsImages,
    supportsResponses,
    supportsReasoning,
    cost: {
      input: inputCost,
      output: outputCost,
      cacheRead,
      cacheWrite
    }
  };
}
function normalizeCrmACloudCatalogResponse(payload) {
  const root = asRecord2(payload);
  const data = root?.data;
  if (!Array.isArray(data)) {
    return [];
  }
  const models = [];
  const seen = /* @__PURE__ */ new Set();
  for (const entry of data) {
    const normalized = normalizeCrmACloudCatalogModel(entry);
    if (!normalized || seen.has(normalized.stableId)) {
      continue;
    }
    seen.add(normalized.stableId);
    models.push(normalized);
  }
  return models;
}
function buildCrmACloudProviderModels(models) {
  return models.map((model) => ({
    id: model.stableId,
    name: `${model.displayName} (Crm-A Cloud)`,
    reasoning: model.reasoning,
    input: [...model.input],
    cost: {
      input: model.cost.input,
      output: model.cost.output,
      cacheRead: model.cost.cacheRead,
      cacheWrite: model.cost.cacheWrite
    },
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens
  }));
}
function buildCrmACloudAgentModelEntries(models) {
  return Object.fromEntries(
    models.map((model) => [
      `crm-a-cloud/${model.stableId}`,
      { alias: `${model.displayName} (Crm-A Cloud)` }
    ])
  );
}
function resolveCrmACloudModel(models, requestedId) {
  const normalized = requestedId?.trim();
  if (!normalized) {
    return models.find((model) => model.id === RECOMMENDED_CRM_A_CLOUD_MODEL_ID) || models[0];
  }
  return models.find((model) => model.id === normalized || model.stableId === normalized);
}
function formatCrmACloudModelHint(model) {
  const parts = [model.provider];
  if (model.reasoning) parts.push("reasoning");
  if (model.id === RECOMMENDED_CRM_A_CLOUD_MODEL_ID) parts.push("recommended");
  return parts.join(" \xB7 ");
}

// extensions/crm-a-ai-gateway/config-patch.ts
var CRM_A_COMPOSIO_WRAPPER_TOOLS = [
  "crm_a_search_integrations",
  "crm_a_execute_integrations"
];
var CRM_A_CLOUD_TOOL_ALLOWLIST = [
  "read",
  "write",
  "edit",
  "apply_patch",
  "exec",
  "process",
  "code_execution",
  "web_fetch",
  "x_search",
  "memory_search",
  "memory_get",
  "sessions_list",
  "sessions_history",
  "sessions_send",
  "sessions_spawn",
  "sessions_yield",
  "subagents",
  "session_status",
  "cron",
  "update_plan",
  "image",
  "image_generate",
  "music_generate",
  "video_generate",
  ...CRM_A_COMPOSIO_WRAPPER_TOOLS
];
function buildCrmACloudProviderConfig(params) {
  return {
    baseUrl: buildCrmAGatewayApiBaseUrl(params.gatewayUrl),
    apiKey: params.apiKey,
    api: "openai-responses",
    models: buildCrmACloudProviderModels(params.models)
  };
}
function buildCrmACloudConfigPatch(params) {
  return {
    models: {
      mode: "merge",
      providers: {
        "crm-a-cloud": buildCrmACloudProviderConfig(params)
      }
    },
    agents: {
      defaults: {
        models: buildCrmACloudAgentModelEntries(params.models)
      }
    },
    messages: {
      tts: {
        provider: "elevenlabs",
        providers: {
          elevenlabs: {
            baseUrl: params.gatewayUrl,
            apiKey: params.apiKey
          }
        }
      }
    },
    tools: {
      alsoAllow: [...CRM_A_COMPOSIO_WRAPPER_TOOLS],
      byProvider: {
        "crm-a-cloud": {
          allow: [...CRM_A_CLOUD_TOOL_ALLOWLIST]
        }
      }
    }
  };
}

// extensions/crm-a-ai-gateway/sync-trigger.ts
import { existsSync as existsSync2, readFileSync as readFileSync2 } from "node:fs";
import { homedir } from "node:os";
import path2 from "node:path";
var DEFAULT_INTERVAL_MS = 5 * 60 * 1e3;
var DEFAULT_WEB_PORT = 3100;
var PROCESS_JSON_REL = path2.join("web-runtime", "process.json");
var FETCH_TIMEOUT_MS = 6e4;
function asRecord3(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : void 0;
}
function readString3(value) {
  return typeof value === "string" && value.trim() ? value.trim() : void 0;
}
function readNumber2(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : void 0;
}
function resolveSyncTriggerConfig(api) {
  const pluginConfig = asRecord3(asRecord3(asRecord3(api?.config)?.plugins)?.entries)?.["crm-a-ai-gateway"];
  return asRecord3(asRecord3(pluginConfig)?.config?.["syncTrigger"]);
}
function resolveStateDir() {
  const fromEnv = process.env.OPENCLAW_STATE_DIR?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  const home = process.env.OPENCLAW_HOME?.trim() || homedir();
  return path2.join(home, ".openclaw-crm-a");
}
function resolveWebPortFromProcessFile(stateDir) {
  const processPath = path2.join(stateDir, PROCESS_JSON_REL);
  if (!existsSync2(processPath)) {
    return void 0;
  }
  try {
    const parsed = JSON.parse(readFileSync2(processPath, "utf-8"));
    return readNumber2(parsed?.port);
  } catch {
    return void 0;
  }
}
function resolveWebBaseUrl(api, syncTriggerConfig) {
  const fromConfig = readString3(syncTriggerConfig?.webBaseUrl);
  if (fromConfig) {
    return fromConfig.replace(/\/$/, "");
  }
  const fromEnv = readString3(process.env.CRM_A_CONSOLE_WEB_BASE_URL);
  if (fromEnv) {
    return fromEnv.replace(/\/$/, "");
  }
  const port = resolveWebPortFromProcessFile(resolveStateDir()) ?? DEFAULT_WEB_PORT;
  return `http://127.0.0.1:${port}`;
}
function outcomeKey(outcome) {
  switch (outcome.kind) {
    case "ok":
      return "ok";
    case "http":
      return `http:${outcome.statusBucket}`;
    case "timeout":
      return "timeout";
    case "network":
      return `network:${outcome.message}`;
  }
}
function describeOutcome(outcome) {
  switch (outcome.kind) {
    case "ok":
      return "ok";
    case "http":
      return `HTTP ${outcome.status}`;
    case "timeout":
      return `timed out after ${FETCH_TIMEOUT_MS}ms`;
    case "network":
      return outcome.message;
  }
}
function bucketFor(status) {
  if (status >= 400 && status < 500) {
    return "4xx";
  }
  if (status >= 500 && status < 600) {
    return "5xx";
  }
  return "other";
}
var _armed = false;
function armSyncTrigger(api) {
  if (_armed) {
    return;
  }
  const config = resolveSyncTriggerConfig(api);
  if (config?.enabled === false) {
    api?.logger?.info?.("[crm-a-ai-gateway] sync-trigger disabled via syncTrigger.enabled=false");
    return;
  }
  const apiKey = readCrmAAuthProfileKey();
  if (!apiKey) {
    api?.logger?.info?.("[crm-a-ai-gateway] No Crm-A Cloud API key; sync trigger not armed.");
    return;
  }
  const intervalMs = readNumber2(config?.intervalMs) ?? DEFAULT_INTERVAL_MS;
  if (intervalMs < 1e3) {
    api?.logger?.info?.(
      `[crm-a-ai-gateway] sync-trigger intervalMs=${intervalMs} below safety floor; not arming.`
    );
    return;
  }
  const webBaseUrl = resolveWebBaseUrl(api, config);
  const tickUrl = `${webBaseUrl}/api/sync/poll-tick`;
  let lastOutcomeKey = "ok";
  async function tick() {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let outcome;
    try {
      const response = await fetch(tickUrl, {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json"
        },
        body: "{}",
        signal: controller.signal
      });
      outcome = response.ok ? { kind: "ok" } : { kind: "http", statusBucket: bucketFor(response.status), status: response.status };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const aborted = err instanceof Error && (err.name === "AbortError" || /aborted/i.test(message));
      outcome = aborted ? { kind: "timeout" } : { kind: "network", message };
    } finally {
      clearTimeout(timeoutHandle);
    }
    const key = outcomeKey(outcome);
    const wasFailing = lastOutcomeKey !== "ok";
    if (outcome.kind === "ok") {
      if (wasFailing) {
        api?.logger?.info?.(`[crm-a-ai-gateway] sync-trigger recovered (was: ${lastOutcomeKey})`);
      }
    } else if (key !== lastOutcomeKey) {
      api?.logger?.info?.(
        `[crm-a-ai-gateway] sync-trigger tick ${describeOutcome(outcome)} from ${tickUrl}`
      );
    }
    lastOutcomeKey = key;
  }
  setInterval(() => {
    void tick();
  }, intervalMs);
  _armed = true;
  api?.logger?.info?.(`[crm-a-ai-gateway] sync-trigger armed (every ${intervalMs}ms \u2192 ${tickUrl})`);
}

// extensions/crm-a-ai-gateway/sync-refresh-tools.ts
var REFRESH_TOOL_NAME = "crm_a_console_refresh_sync";
var RESYNC_TOOL_NAME = "crm_a_console_resync_full";
var REFRESH_TIMEOUT_MS = 3e4;
var RESYNC_TIMEOUT_MS = 6e4;
var REFRESH_PARAMETERS = {
  type: "object",
  additionalProperties: false,
  properties: {}
};
function jsonResult2(payload, details) {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    details: details ?? payload
  };
}
function summarize(mode, body) {
  if (body.ok === false) {
    return `Sync ${mode} failed: ${body.error ?? "unknown error"}`;
  }
  if (body.alreadyRunning) {
    return `A ${mode} sync is already running \u2014 no new tick started.`;
  }
  if (body.skipped === "backfill-in-progress") {
    return "Skipped incremental tick because a full backfill is currently in progress.";
  }
  const evt = body.lastEvent;
  if (evt?.phase === "error") {
    return `Sync ${mode} reported an error: ${evt.error ?? evt.message ?? "unknown"}`;
  }
  if (mode === "incremental") {
    const newMessages = evt?.messagesProcessed ?? 0;
    const newEvents = evt?.eventsProcessed ?? 0;
    if (newMessages === 0 && newEvents === 0) {
      return "Incremental sync ran \u2014 no new emails or calendar events since the last tick.";
    }
    const parts = [];
    if (newMessages > 0) {
      parts.push(`${newMessages} new email${newMessages === 1 ? "" : "s"}`);
    }
    if (newEvents > 0) {
      parts.push(`${newEvents} new event${newEvents === 1 ? "" : "s"}`);
    }
    return `Synced ${parts.join(" and ")}.`;
  }
  if (body.started) {
    return "Full backfill started \u2014 Gmail and Calendar are re-importing in the background.";
  }
  return "Full backfill request acknowledged.";
}
async function callRefreshRoute(webBaseUrl, mode, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${webBaseUrl}/api/sync/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ mode }),
      signal: controller.signal
    });
    const text = await res.text();
    let body = {};
    if (text.trim()) {
      try {
        body = JSON.parse(text);
      } catch {
        body = { error: text.slice(0, 240) };
      }
    }
    return { status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}
function createRefreshSyncTool(api) {
  const webBaseUrl = resolveWebBaseUrl(api, resolveSyncTriggerConfig(api));
  return {
    name: REFRESH_TOOL_NAME,
    label: "Refresh Gmail/Calendar sync",
    description: "Trigger an incremental Gmail and Calendar sync tick right now. Use this when the user asks to refresh, sync now, pull new emails, or check whether anything new has arrived. Cheap and fast (1-2 seconds). For a full re-import use crm_a_console_resync_full instead.",
    parameters: REFRESH_PARAMETERS,
    async execute(_toolCallId, _input) {
      try {
        const { status, body } = await callRefreshRoute(
          webBaseUrl,
          "incremental",
          REFRESH_TIMEOUT_MS
        );
        if (status >= 400) {
          return jsonResult2(
            {
              error: body.error ?? `Refresh failed (HTTP ${status}).`,
              mode: "incremental"
            },
            { status: "error", httpStatus: status }
          );
        }
        return {
          content: [{ type: "text", text: summarize("incremental", body) }],
          details: { mode: "incremental", response: body }
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return jsonResult2(
          { error: `Refresh request failed: ${message}`, mode: "incremental" },
          { status: "error" }
        );
      }
    }
  };
}
function createResyncFullTool(api) {
  const webBaseUrl = resolveWebBaseUrl(api, resolveSyncTriggerConfig(api));
  return {
    name: RESYNC_TOOL_NAME,
    label: "Full Gmail/Calendar resync",
    description: "Trigger a full Gmail and Calendar backfill \u2014 re-imports messages and events from scratch. Use this only when the user explicitly asks for a full resync, after they have reconnected an account, or when the incremental refresh (crm_a_console_refresh_sync) repeatedly fails to surface messages they expect to see. Heavier than incremental sync; runs in the background.",
    parameters: REFRESH_PARAMETERS,
    async execute(_toolCallId, _input) {
      try {
        const { status, body } = await callRefreshRoute(webBaseUrl, "backfill", RESYNC_TIMEOUT_MS);
        if (status >= 400) {
          return jsonResult2(
            {
              error: body.error ?? `Resync failed (HTTP ${status}).`,
              mode: "backfill"
            },
            { status: "error", httpStatus: status }
          );
        }
        return {
          content: [{ type: "text", text: summarize("backfill", body) }],
          details: { mode: "backfill", response: body }
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return jsonResult2(
          { error: `Resync request failed: ${message}`, mode: "backfill" },
          { status: "error" }
        );
      }
    }
  };
}
function registerSyncRefreshTools(api) {
  const refresh = createRefreshSyncTool(api);
  const resync = createResyncFullTool(api);
  api.registerTool(refresh, { name: REFRESH_TOOL_NAME, optional: true });
  api.registerTool(resync, { name: RESYNC_TOOL_NAME, optional: true });
  return [refresh.name, resync.name];
}

// extensions/crm-a-ai-gateway/index.ts
var id = "crm-a-ai-gateway";
var PROVIDER_ID = "crm-a-cloud";
var PROVIDER_LABEL = "Crm-A Cloud";
var API_KEY_ENV_VARS = ["CRM_A_CLOUD_API_KEY", "CRM_A_API_KEY"];
function asRecord4(value) {
  return value && typeof value === "object" ? value : void 0;
}
function resolvePluginConfig(api) {
  const pluginConfig = api?.config?.plugins?.entries?.["crm-a-ai-gateway"]?.config;
  return asRecord4(pluginConfig);
}
function resolveGatewayUrl(api) {
  const pluginConfig = resolvePluginConfig(api);
  const configured = typeof pluginConfig?.gatewayUrl === "string" ? pluginConfig.gatewayUrl : void 0;
  return normalizeCrmAGatewayUrl(
    configured || process.env.CRM_A_GATEWAY_URL || DEFAULT_CRM_A_CLOUD_GATEWAY_URL
  );
}
function resolveEnvApiKey() {
  for (const envVar of API_KEY_ENV_VARS) {
    const value = process.env[envVar]?.trim();
    if (value) {
      return value;
    }
  }
  return void 0;
}
async function promptForApiKey(prompter) {
  if (typeof prompter?.secret === "function") {
    return String(
      await prompter.secret(
        "Enter your Crm-A Cloud API key (sign up at dench.com and get it at dench.com/settings)"
      )
    ).trim();
  }
  return String(
    await prompter.text({
      message: "Enter your Crm-A Cloud API key (sign up at dench.com and get it at dench.com/settings)"
    })
  ).trim();
}
async function fetchCrmACloudCatalog(gatewayUrl) {
  try {
    const response = await fetch(buildCrmAGatewayCatalogUrl(gatewayUrl));
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const payload = await response.json().catch(() => null);
    const models = normalizeCrmACloudCatalogResponse(payload);
    if (!models.length) {
      throw new Error("response did not contain any usable models");
    }
    return { models, source: "live" };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      models: cloneFallbackCrmACloudModels(),
      source: "fallback",
      detail
    };
  }
}
var CRM_A_CLOUD_API_KEY_VALIDATION_TIMEOUT_MS = 15e3;
async function validateCrmACloudApiKey(gatewayUrl, apiKey) {
  const apiBaseUrl = buildCrmAGatewayApiBaseUrl(gatewayUrl);
  let response;
  try {
    response = await fetch(`${apiBaseUrl}/models`, {
      headers: {
        Authorization: `Bearer ${apiKey}`
      },
      signal: AbortSignal.timeout(CRM_A_CLOUD_API_KEY_VALIDATION_TIMEOUT_MS)
    });
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Could not reach Crm-A Cloud gateway at ${apiBaseUrl} (${cause}). Check your network connection and gateway URL, then try again.`
    );
  }
  if (response.ok) {
    return;
  }
  const message = response.status === 401 || response.status === 403 ? "Invalid Crm-A Cloud API key." : `Crm-A Cloud validation failed with HTTP ${response.status}.`;
  throw new Error(`${message} Check your key at dench.com/settings.`);
}
async function promptForModelSelection(params) {
  const selectedStableId = String(
    await params.prompter.select({
      message: "Choose your default Crm-A Cloud model",
      options: params.models.map((model) => ({
        value: model.stableId,
        label: model.displayName,
        hint: formatCrmACloudModelHint(model)
      })),
      ...params.initialStableId ? { initialValue: params.initialStableId } : {}
    })
  );
  const selected = resolveCrmACloudModel(params.models, selectedStableId);
  if (!selected) {
    throw new Error(`Unknown Crm-A Cloud model "${selectedStableId}".`);
  }
  return selected;
}
function buildAuthNotes(params) {
  const notes = [
    `Crm-A Cloud uses ${buildCrmAGatewayApiBaseUrl(params.gatewayUrl)} for model traffic.`
  ];
  if (params.catalog.source === "fallback") {
    notes.push(
      `Model catalog fell back to Crm-A Console's bundled list (${params.catalog.detail ?? "public catalog unavailable"}).`
    );
  }
  return notes;
}
function buildProviderAuthResult(params) {
  return {
    profiles: [
      {
        profileId: `${PROVIDER_ID}:default`,
        credential: {
          type: "api_key",
          provider: PROVIDER_ID,
          key: params.apiKey
        }
      }
    ],
    defaultModel: `${PROVIDER_ID}/${params.selected.stableId}`,
    configPatch: buildCrmACloudConfigPatch({
      gatewayUrl: params.gatewayUrl,
      apiKey: params.apiKey,
      models: params.catalog.models
    }),
    notes: buildAuthNotes({
      gatewayUrl: params.gatewayUrl,
      catalog: params.catalog
    })
  };
}
async function runInteractiveAuth(ctx, gatewayUrl) {
  const apiKey = await promptForApiKey(ctx.prompter);
  if (!apiKey) {
    throw new Error("A Crm-A Cloud API key is required.");
  }
  await validateCrmACloudApiKey(gatewayUrl, apiKey);
  const catalog = await fetchCrmACloudCatalog(gatewayUrl);
  const selected = await promptForModelSelection({
    prompter: ctx.prompter,
    models: catalog.models
  });
  return buildProviderAuthResult({
    gatewayUrl,
    apiKey,
    catalog,
    selected
  });
}
async function runNonInteractiveAuth(ctx, gatewayUrl) {
  const apiKey = String(
    ctx?.opts?.crmACloudApiKey || ctx?.opts?.crmACloudKey || resolveEnvApiKey() || ""
  ).trim();
  if (!apiKey) {
    throw new Error(
      "Crm-A Cloud non-interactive auth requires CRM_A_CLOUD_API_KEY or --crm-a-cloud-api-key."
    );
  }
  await validateCrmACloudApiKey(gatewayUrl, apiKey);
  const catalog = await fetchCrmACloudCatalog(gatewayUrl);
  const selected = resolveCrmACloudModel(
    catalog.models,
    String(ctx?.opts?.crmACloudModel || process.env.CRM_A_CLOUD_MODEL || "").trim()
  );
  if (!selected) {
    throw new Error("Configured Crm-A Cloud model is not available.");
  }
  return buildProviderAuthResult({
    gatewayUrl,
    apiKey,
    catalog,
    selected
  });
}
function buildDiscoveryProvider(api, gatewayUrl) {
  const configured = api?.config?.models?.providers?.[PROVIDER_ID];
  if (configured && typeof configured === "object") {
    return configured;
  }
  const apiKey = resolveEnvApiKey();
  if (!apiKey) {
    return null;
  }
  const models = cloneFallbackCrmACloudModels();
  return buildCrmACloudProviderConfig({ gatewayUrl, apiKey, models });
}
function register(api) {
  const pluginConfig = resolvePluginConfig(api);
  if (pluginConfig?.enabled === false) {
    return;
  }
  const gatewayUrl = resolveGatewayUrl(api);
  api.registerProvider({
    id: PROVIDER_ID,
    label: PROVIDER_LABEL,
    docsPath: "/providers/models",
    aliases: ["crm-a", "crm-a-cloud", "crm-a-ai-gateway"],
    envVars: [...API_KEY_ENV_VARS],
    auth: [
      {
        id: "api-key",
        label: "Crm-A Cloud API Key",
        hint: "Use your Crm-A Cloud key from dench.com/settings",
        kind: "api_key",
        run: async (ctx) => await runInteractiveAuth(ctx, gatewayUrl),
        // Newer OpenClaw builds can call this hook during headless onboarding.
        runNonInteractive: async (ctx) => await runNonInteractiveAuth(ctx, gatewayUrl)
      }
    ],
    // Newer OpenClaw builds can surface provider-specific wizard entries.
    wizard: {
      onboarding: {
        choiceId: PROVIDER_ID,
        choiceLabel: PROVIDER_LABEL,
        choiceHint: "Use Crm-A's managed AI gateway",
        groupId: "crm-a",
        groupLabel: "Crm-A",
        groupHint: "Managed Crm-A Cloud models",
        methodId: "api-key"
      },
      modelPicker: {
        label: PROVIDER_LABEL,
        hint: "Connect Crm-A Cloud with your API key",
        methodId: "api-key"
      }
    },
    // Best-effort discovery so newer OpenClaw builds can rehydrate provider config.
    discovery: {
      order: "profile",
      run: async () => {
        const provider = buildDiscoveryProvider(api, gatewayUrl);
        return provider ? { provider } : null;
      }
    }
  });
  registerCrmAIntegrationsBridge(api, gatewayUrl);
  armSyncTrigger(api);
  if (typeof api?.registerTool === "function" && readCrmAAuthProfileKey()) {
    const registered = registerSyncRefreshTools(api);
    api.logger?.info?.(
      `[crm-a-ai-gateway] registered sync refresh tools: ${registered.join(", ")}`
    );
  }
  api.registerService({
    id: "crm-a-ai-gateway",
    start: () => {
      api.logger?.info?.(`[crm-a-ai-gateway] active (gateway: ${gatewayUrl})`);
    },
    stop: () => {
      api.logger?.info?.("[crm-a-ai-gateway] stopped");
    }
  });
}
export {
  buildCrmACloudConfigPatch,
  register as default,
  fetchCrmACloudCatalog,
  id,
  validateCrmACloudApiKey
};
