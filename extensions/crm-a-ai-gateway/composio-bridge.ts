import type { AnyAgentTool } from "openclaw/plugin-sdk";
import { readCrmAAuthProfileKey } from "../shared/crm-a-auth.js";

type UnknownRecord = Record<string, unknown>;

const CRM_A_EXECUTE_INTEGRATIONS_NAME = "crm_a_execute_integrations";
const CRM_A_INTEGRATIONS_DISPLAY_NAME = "Crm-A Integrations";

const CRM_A_EXECUTE_INTEGRATIONS_PARAMETERS = {
  type: "object",
  additionalProperties: false,
  properties: {
    tool_slug: {
      type: "string",
      description:
        "Exact tool slug returned by crm_a_search_integrations, for example GMAIL_FETCH_EMAILS or YOUTUBE_LIST_USER_SUBSCRIPTIONS.",
    },
    arguments: {
      type: "object",
      additionalProperties: true,
      description:
        "JSON arguments object matching the tool's input_schema from the search results.",
      properties: {},
    },
    connected_account_id: {
      type: "string",
      description:
        "Optional connected account id. Required only when multiple accounts are connected for the same toolkit. The gateway auto-selects when only one account exists.",
    },
  },
  required: ["tool_slug"],
} as const;

function asRecord(value: unknown): UnknownRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function jsonResult(payload: unknown, details?: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
    details: details ?? payload,
  };
}

function resolveGatewayBaseUrl(api: any, fallbackGatewayUrl: string): string {
  const plugins = asRecord(asRecord(api?.config)?.plugins)?.entries;
  const crmAGateway = asRecord(asRecord(plugins)?.["crm-a-ai-gateway"]);
  const gwConfig = asRecord(crmAGateway?.config);
  const configuredUrl = readString(gwConfig?.gatewayUrl);
  return (configuredUrl ?? fallbackGatewayUrl).replace(/\/$/, "");
}

/**
 * Composio user that owns the workspace's connected accounts. All
 * connect + execute flows must use the SAME user — Composio rejects
 * execution when the user_id does not match the account's owner
 * (code 1812 ConnectedAccountUserIdMismatch).
 */
function resolveComposioUserId(): string {
  return process.env.COMPOSIO_USER_ID?.trim() || "crm-a-console";
}

function resolveApiKey(): string | undefined {
  return readCrmAAuthProfileKey() ?? undefined;
}

function createCrmAExecuteIntegrationsTool(params: {
  gatewayBaseUrl: string;
  authorization?: string;
  /** Direct Composio Platform API key — bypasses the gateway entirely. */
  directApiKey?: string;
}): AnyAgentTool {
  return {
    name: CRM_A_EXECUTE_INTEGRATIONS_NAME,
    label: `${CRM_A_INTEGRATIONS_DISPLAY_NAME} Execute`,
    description: `Execute a ${CRM_A_INTEGRATIONS_DISPLAY_NAME.toLowerCase()} tool by its slug. Pass the tool_slug from crm_a_search_integrations and the arguments matching its input_schema. The gateway handles authentication and account selection.`,
    parameters: CRM_A_EXECUTE_INTEGRATIONS_PARAMETERS,
    async execute(_toolCallId: string, input: Record<string, unknown>) {
      const payload = asRecord(input) ?? {};
      const toolSlug = readString(payload.tool_slug)?.trim();
      const connectedAccountId = readString(payload.connected_account_id)?.trim();
      const toolArgs = asRecord(payload.arguments) ?? {};

      if (!toolSlug) {
        return jsonResult({
          error:
            "The `tool_slug` field is required. Use crm_a_search_integrations to find available tools first.",
        });
      }

      try {
        // Direct mode: Composio Platform API v3.1 with the workspace's own key.
        if (params.directApiKey) {
          const res = await fetch(
            `https://backend.composio.dev/api/v3.1/tools/execute/${encodeURIComponent(toolSlug)}`,
            {
              method: "POST",
              headers: {
                "content-type": "application/json",
                accept: "application/json",
                "x-api-key": params.directApiKey,
              },
              body: JSON.stringify({
                arguments: toolArgs,
                // Composio v3.1 requires user_id even when an explicit
                // connected_account_id is provided ("User ID is required
                // with connected account") — always send the connect-time id.
                user_id: resolveComposioUserId(),
                ...(connectedAccountId
                  ? { connected_account_id: connectedAccountId }
                  : {}),
              }),
            },
          );
          const text = await res.text();
          let parsed: UnknownRecord | undefined;
          try {
            parsed = JSON.parse(text) as UnknownRecord;
          } catch {
            parsed = undefined;
          }
          if (!res.ok) {
            return jsonResult({
              error: `Composio ${toolSlug} failed: HTTP ${res.status}${text ? ` — ${text.slice(0, 240)}` : ""}`,
            });
          }
          if (parsed?.successful === false || readString(parsed?.error)) {
            const upstreamError = readString(parsed?.error) ?? "unknown error";
            // Composio code 1812: the connected account belongs to a
            // different user than the one we authenticated with. Happens
            // when COMPOSIO_USER_ID changes after tools were connected.
            if (readString(asRecord(parsed?.error)?.slug) === "ActionExecute_ConnectedAccountEntityIdMismatch") {
              return jsonResult({
                error: `Composio ${toolSlug} failed: the connected account belongs to a different Composio user.`,
                guidance:
                  "Ask the user to reconnect this integration (the new connection will bind to the current user), or unset COMPOSIO_USER_ID to use the legacy user. Then retry.",
                not_connected: true,
              });
            }
            return jsonResult({
              error: `Composio ${toolSlug} failed: ${upstreamError}`,
            });
          }
          return jsonResult(parsed?.data ?? parsed ?? {});
        }

        const res = await fetch(`${params.gatewayBaseUrl}/v1/composio/tools/execute`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
            ...(params.authorization ? { authorization: params.authorization } : {}),
          },
          body: JSON.stringify({
            tool_slug: toolSlug,
            arguments: toolArgs,
            ...(connectedAccountId ? { connected_account_id: connectedAccountId } : {}),
          }),
        });

        const text = await res.text();
        let parsed: UnknownRecord | undefined;
        try {
          parsed = JSON.parse(text) as UnknownRecord;
        } catch {
          parsed = undefined;
        }

        if (!res.ok) {
          const errorCode = readString(asRecord(parsed?.error)?.code) ?? readString(parsed?.code);
          const errorMessage =
            readString(asRecord(parsed?.error)?.message) ?? readString(parsed?.error) ?? text;

          if (errorCode === "composio_account_selection_required") {
            return jsonResult(
              {
                error: errorMessage,
                account_selection_required: true,
                instruction:
                  "Ask the user which connected account to use and pass its connected_account_id.",
              },
              { status: "error", errorCode, tool_slug: toolSlug },
            );
          }

          if (errorCode === "composio_not_connected") {
            return jsonResult(
              { error: errorMessage, not_connected: true },
              { status: "error", errorCode, tool_slug: toolSlug },
            );
          }

          return jsonResult(
            {
              error: `${CRM_A_INTEGRATIONS_DISPLAY_NAME} tool ${toolSlug} failed (HTTP ${res.status}).`,
              detail: parsed ?? (text || undefined),
            },
            { status: "error", tool_slug: toolSlug },
          );
        }

        const data = parsed?.data;
        const error = readString(parsed?.error);
        const contentPayload = error ? { error, data } : (data ?? parsed ?? {});

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(contentPayload, null, 2),
            },
          ],
          details: {
            crmAIntegrations: true,
            tool_slug: toolSlug,
            ...(parsed?.log_id ? { logId: parsed.log_id } : {}),
            ...(data !== undefined ? { structuredContent: data } : {}),
            ...(error ? { status: "error", error } : {}),
            ...(connectedAccountId ? { connectedAccountId } : {}),
          },
        };
      } catch (error) {
        return jsonResult(
          {
            error: `${CRM_A_INTEGRATIONS_DISPLAY_NAME} tool ${toolSlug} failed.`,
            detail: error instanceof Error ? error.message : String(error),
          },
          { status: "error", tool_slug: toolSlug },
        );
      }
    },
  } as AnyAgentTool;
}

function stripRuntimeComposioServer(api: any): void {
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

export function registerCrmAIntegrationsBridge(api: any, fallbackGatewayUrl: string) {
  stripRuntimeComposioServer(api);

  // Direct Composio mode: a workspace-level COMPOSIO_API_KEY bypasses the
  // Crm-A Cloud gateway entirely — the execute tool talks to the Platform
  // API (v3.1) directly.
  const directApiKey = process.env.COMPOSIO_API_KEY?.trim();
  if (directApiKey) {
    api.registerTool(createCrmAExecuteIntegrationsTool({ directApiKey }), {
      name: CRM_A_EXECUTE_INTEGRATIONS_NAME,
      optional: true,
    });
    api.logger?.info?.(
      `[crm-a-ai-gateway] registered ${CRM_A_EXECUTE_INTEGRATIONS_NAME} bridge tool (direct Composio)`,
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
    authorization: `Bearer ${apiKey}`,
  });

  api.registerTool(tool, {
    name: CRM_A_EXECUTE_INTEGRATIONS_NAME,
    optional: true,
  });
  api.logger?.info?.(
    `[crm-a-ai-gateway] registered ${CRM_A_EXECUTE_INTEGRATIONS_NAME} bridge tool`,
  );
}
