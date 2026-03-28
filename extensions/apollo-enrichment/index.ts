import { Type } from "@sinclair/typebox";
import type { AnyAgentTool, OpenClawPluginApi } from "openclaw/plugin-sdk";

export const id = "apollo-enrichment";

const DEFAULT_GATEWAY_URL = "https://gateway.merseoriginals.com";
const ENRICHMENT_BASE_PATH = "/v1/enrichment";

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | undefined {
  return value && typeof value === "object" ? (value as UnknownRecord) : undefined;
}

function resolveGatewayUrl(config: any): string {
  const gatewayConfig = asRecord(
    asRecord(config?.plugins?.entries?.["dench-ai-gateway"])?.config,
  );
  const configured =
    typeof gatewayConfig?.gatewayUrl === "string"
      ? gatewayConfig.gatewayUrl.trim()
      : undefined;
  return (
    configured ||
    process.env.DENCH_GATEWAY_URL?.trim() ||
    DEFAULT_GATEWAY_URL
  );
}

function resolveApiKey(config: any): string | undefined {
  const provider = asRecord(
    asRecord(config?.models?.providers)?.["dench-cloud"],
  );
  if (provider) {
    const key = provider.apiKey;
    if (typeof key === "string" && key.trim()) return key.trim();
  }
  return (
    process.env.DENCH_CLOUD_API_KEY?.trim() ||
    process.env.DENCH_API_KEY?.trim() ||
    undefined
  );
}

function jsonResult(payload: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
    details: payload,
  };
}

const ApolloEnrichParameters = Type.Object(
  {
    action: Type.Unsafe<"person" | "company">({
      type: "string",
      enum: ["person", "company"],
      description:
        'The enrichment action to perform. "person" looks up a person by email, name, or domain. "company" looks up an organization by domain.',
    }),
    email: Type.Optional(
      Type.String({ description: "Email address to enrich (person action)." }),
    ),
    first_name: Type.Optional(
      Type.String({ description: "First name of the person to enrich." }),
    ),
    last_name: Type.Optional(
      Type.String({ description: "Last name of the person to enrich." }),
    ),
    domain: Type.Optional(
      Type.String({
        description:
          "Company domain (e.g. acme.com). Required for company action, optional hint for person action.",
      }),
    ),
    organization_name: Type.Optional(
      Type.String({
        description: "Company name hint for person enrichment.",
      }),
    ),
  },
  { additionalProperties: false },
);

async function executeApolloEnrich(
  gatewayUrl: string,
  apiKey: string,
  _toolCallId: string,
  params: Record<string, unknown>,
) {
  const action = params.action as string;
  if (action !== "person" && action !== "company") {
    return jsonResult({ error: `Unknown action "${action}". Use "person" or "company".` });
  }

  const endpoint = `${gatewayUrl}${ENRICHMENT_BASE_PATH}/${action}`;
  const body: Record<string, unknown> = {};

  if (action === "person") {
    if (params.email) body.email = params.email;
    if (params.first_name) body.first_name = params.first_name;
    if (params.last_name) body.last_name = params.last_name;
    if (params.domain) body.domain = params.domain;
    if (params.organization_name) body.organization_name = params.organization_name;

    if (!body.email && !body.first_name && !body.last_name) {
      return jsonResult({
        error: "Person enrichment requires at least an email or a name (first_name / last_name).",
      });
    }
  } else {
    if (params.domain) body.domain = params.domain;
    if (!body.domain) {
      return jsonResult({ error: "Company enrichment requires a domain." });
    }
  }

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return jsonResult({
        error: `Enrichment request failed (HTTP ${response.status}).`,
        detail: text || undefined,
      });
    }

    const data = await response.json();
    return jsonResult(data);
  } catch (err) {
    return jsonResult({
      error: "Enrichment request failed.",
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}

export default function register(api: OpenClawPluginApi) {
  const pluginConfig = asRecord(
    asRecord((api as any).config?.plugins?.entries?.[id])?.config,
  );
  if (pluginConfig?.enabled === false) {
    return;
  }

  const gatewayUrl = resolveGatewayUrl((api as any).config);
  const apiKey = resolveApiKey((api as any).config);

  if (!apiKey) {
    api.logger?.info?.(
      "[apollo-enrichment] No Dench Cloud API key found; tool will not be registered.",
    );
    return;
  }

  api.registerTool(
    {
      name: "apollo_enrich",
      label: "Apollo Enrichment",
      description:
        "Look up a person or company using Apollo enrichment data. " +
        'Use action "person" with an email, name, or domain to find a person\'s profile, ' +
        'title, company, LinkedIn, and contact info. Use action "company" with a domain ' +
        "to get company details like size, industry, revenue, and social links.",
      parameters: ApolloEnrichParameters,
      execute: (toolCallId: string, params: Record<string, unknown>) =>
        executeApolloEnrich(gatewayUrl, apiKey, toolCallId, params),
    } as AnyAgentTool,
    { optional: true },
  );
}
