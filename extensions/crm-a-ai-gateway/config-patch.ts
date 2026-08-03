import {
  buildCrmACloudAgentModelEntries,
  buildCrmACloudProviderModels,
  buildCrmAGatewayApiBaseUrl,
  type CrmACloudCatalogModel,
} from "./models.js";

export type CrmACloudProviderConfig = {
  baseUrl: string;
  apiKey: string;
  api: "openai-completions" | "openai-responses";
  models: ReturnType<typeof buildCrmACloudProviderModels>;
};

export type ComposioMcpServerConfig = {
  url: string;
  transport: "streamable-http";
  headers: {
    Authorization: string;
  };
};

const CRM_A_COMPOSIO_WRAPPER_TOOLS = [
  "crm_a_search_integrations",
  "crm_a_execute_integrations",
] as const;
const CRM_A_CLOUD_TOOL_ALLOWLIST = [
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
  ...CRM_A_COMPOSIO_WRAPPER_TOOLS,
] as const;

export function buildComposioMcpServerConfig(
  gatewayUrl: string,
  apiKey: string,
): ComposioMcpServerConfig {
  return {
    url: `${gatewayUrl}/v1/composio/mcp`,
    transport: "streamable-http",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  };
}

export function buildCrmACloudProviderConfig(params: {
  gatewayUrl: string;
  apiKey: string;
  models: CrmACloudCatalogModel[];
}): CrmACloudProviderConfig {
  return {
    baseUrl: buildCrmAGatewayApiBaseUrl(params.gatewayUrl),
    apiKey: params.apiKey,
    api: "openai-responses",
    models: buildCrmACloudProviderModels(params.models),
  };
}

export function buildCrmACloudConfigPatch(params: {
  gatewayUrl: string;
  apiKey: string;
  models: CrmACloudCatalogModel[];
}) {
  return {
    models: {
      mode: "merge" as const,
      providers: {
        "crm-a-cloud": buildCrmACloudProviderConfig(params),
      },
    },
    agents: {
      defaults: {
        models: buildCrmACloudAgentModelEntries(params.models),
      },
    },
    messages: {
      tts: {
        provider: "elevenlabs",
        providers: {
          elevenlabs: {
            baseUrl: params.gatewayUrl,
            apiKey: params.apiKey,
          },
        },
      },
    },
    tools: {
      alsoAllow: [...CRM_A_COMPOSIO_WRAPPER_TOOLS],
      byProvider: {
        "crm-a-cloud": {
          allow: [...CRM_A_CLOUD_TOOL_ALLOWLIST],
        },
      },
    },
  };
}
