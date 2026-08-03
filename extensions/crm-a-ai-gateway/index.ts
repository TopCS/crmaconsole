import { readCrmAAuthProfileKey } from "../shared/crm-a-auth.js";
import { registerCrmAIntegrationsBridge } from "./composio-bridge.js";
import { buildCrmACloudConfigPatch, buildCrmACloudProviderConfig } from "./config-patch.js";
import {
  buildCrmAGatewayApiBaseUrl,
  buildCrmAGatewayCatalogUrl,
  cloneFallbackCrmACloudModels,
  DEFAULT_CRM_A_CLOUD_GATEWAY_URL,
  formatCrmACloudModelHint,
  normalizeCrmACloudCatalogResponse,
  normalizeCrmAGatewayUrl,
  resolveCrmACloudModel,
  type CrmACloudCatalogModel,
} from "./models.js";
import { registerSyncRefreshTools } from "./sync-refresh-tools.js";
import { armSyncTrigger } from "./sync-trigger.js";
export { buildCrmACloudConfigPatch } from "./config-patch.js";

export const id = "crm-a-ai-gateway";

const PROVIDER_ID = "crm-a-cloud";
const PROVIDER_LABEL = "Crm-A Cloud";
const API_KEY_ENV_VARS = ["CRM_A_CLOUD_API_KEY", "CRM_A_API_KEY"] as const;

type CatalogSource = "live" | "fallback";

type CatalogLoadResult = {
  models: CrmACloudCatalogModel[];
  source: CatalogSource;
  detail?: string;
};

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | undefined {
  return value && typeof value === "object" ? (value as UnknownRecord) : undefined;
}

function resolvePluginConfig(api: any): UnknownRecord | undefined {
  const pluginConfig = api?.config?.plugins?.entries?.["crm-a-ai-gateway"]?.config;
  return asRecord(pluginConfig);
}

function resolveGatewayUrl(api: any): string {
  const pluginConfig = resolvePluginConfig(api);
  const configured =
    typeof pluginConfig?.gatewayUrl === "string" ? pluginConfig.gatewayUrl : undefined;
  return normalizeCrmAGatewayUrl(
    configured || process.env.CRM_A_GATEWAY_URL || DEFAULT_CRM_A_CLOUD_GATEWAY_URL,
  );
}

function resolveEnvApiKey(): string | undefined {
  for (const envVar of API_KEY_ENV_VARS) {
    const value = process.env[envVar]?.trim();
    if (value) {
      return value;
    }
  }
  return undefined;
}

async function promptForApiKey(prompter: any): Promise<string> {
  if (typeof prompter?.secret === "function") {
    return String(
      await prompter.secret(
        "Enter your Crm-A Cloud API key (sign up at dench.com and get it at dench.com/settings)",
      ),
    ).trim();
  }

  return String(
    await prompter.text({
      message:
        "Enter your Crm-A Cloud API key (sign up at dench.com and get it at dench.com/settings)",
    }),
  ).trim();
}

export async function fetchCrmACloudCatalog(gatewayUrl: string): Promise<CatalogLoadResult> {
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
      detail,
    };
  }
}

const CRM_A_CLOUD_API_KEY_VALIDATION_TIMEOUT_MS = 15_000;

export async function validateCrmACloudApiKey(gatewayUrl: string, apiKey: string): Promise<void> {
  const apiBaseUrl = buildCrmAGatewayApiBaseUrl(gatewayUrl);
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}/models`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      signal: AbortSignal.timeout(CRM_A_CLOUD_API_KEY_VALIDATION_TIMEOUT_MS),
    });
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Could not reach Crm-A Cloud gateway at ${apiBaseUrl} (${cause}). Check your network connection and gateway URL, then try again.`,
    );
  }

  if (response.ok) {
    return;
  }

  const message =
    response.status === 401 || response.status === 403
      ? "Invalid Crm-A Cloud API key."
      : `Crm-A Cloud validation failed with HTTP ${response.status}.`;
  throw new Error(`${message} Check your key at dench.com/settings.`);
}

async function promptForModelSelection(params: {
  prompter: any;
  models: CrmACloudCatalogModel[];
  initialStableId?: string;
}): Promise<CrmACloudCatalogModel> {
  const selectedStableId = String(
    await params.prompter.select({
      message: "Choose your default Crm-A Cloud model",
      options: params.models.map((model) => ({
        value: model.stableId,
        label: model.displayName,
        hint: formatCrmACloudModelHint(model),
      })),
      ...(params.initialStableId ? { initialValue: params.initialStableId } : {}),
    }),
  );

  const selected = resolveCrmACloudModel(params.models, selectedStableId);
  if (!selected) {
    throw new Error(`Unknown Crm-A Cloud model "${selectedStableId}".`);
  }
  return selected;
}

function buildAuthNotes(params: { gatewayUrl: string; catalog: CatalogLoadResult }): string[] {
  const notes = [
    `Crm-A Cloud uses ${buildCrmAGatewayApiBaseUrl(params.gatewayUrl)} for model traffic.`,
  ];

  if (params.catalog.source === "fallback") {
    notes.push(
      `Model catalog fell back to Crm-A Console's bundled list (${params.catalog.detail ?? "public catalog unavailable"}).`,
    );
  }

  return notes;
}

function buildProviderAuthResult(params: {
  gatewayUrl: string;
  apiKey: string;
  catalog: CatalogLoadResult;
  selected: CrmACloudCatalogModel;
}) {
  return {
    profiles: [
      {
        profileId: `${PROVIDER_ID}:default`,
        credential: {
          type: "api_key",
          provider: PROVIDER_ID,
          key: params.apiKey,
        },
      },
    ],
    defaultModel: `${PROVIDER_ID}/${params.selected.stableId}`,
    configPatch: buildCrmACloudConfigPatch({
      gatewayUrl: params.gatewayUrl,
      apiKey: params.apiKey,
      models: params.catalog.models,
    }),
    notes: buildAuthNotes({
      gatewayUrl: params.gatewayUrl,
      catalog: params.catalog,
    }),
  };
}

async function runInteractiveAuth(ctx: any, gatewayUrl: string) {
  const apiKey = await promptForApiKey(ctx.prompter);
  if (!apiKey) {
    throw new Error("A Crm-A Cloud API key is required.");
  }

  await validateCrmACloudApiKey(gatewayUrl, apiKey);
  const catalog = await fetchCrmACloudCatalog(gatewayUrl);
  const selected = await promptForModelSelection({
    prompter: ctx.prompter,
    models: catalog.models,
  });

  return buildProviderAuthResult({
    gatewayUrl,
    apiKey,
    catalog,
    selected,
  });
}

async function runNonInteractiveAuth(ctx: any, gatewayUrl: string) {
  const apiKey = String(
    ctx?.opts?.crmACloudApiKey || ctx?.opts?.crmACloudKey || resolveEnvApiKey() || "",
  ).trim();
  if (!apiKey) {
    throw new Error(
      "Crm-A Cloud non-interactive auth requires CRM_A_CLOUD_API_KEY or --crm-a-cloud-api-key.",
    );
  }

  await validateCrmACloudApiKey(gatewayUrl, apiKey);
  const catalog = await fetchCrmACloudCatalog(gatewayUrl);
  const selected = resolveCrmACloudModel(
    catalog.models,
    String(ctx?.opts?.crmACloudModel || process.env.CRM_A_CLOUD_MODEL || "").trim(),
  );
  if (!selected) {
    throw new Error("Configured Crm-A Cloud model is not available.");
  }

  return buildProviderAuthResult({
    gatewayUrl,
    apiKey,
    catalog,
    selected,
  });
}

function buildDiscoveryProvider(api: any, gatewayUrl: string) {
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

export default function register(api: any) {
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
        run: async (ctx: any) => await runInteractiveAuth(ctx, gatewayUrl),
        // Newer OpenClaw builds can call this hook during headless onboarding.
        runNonInteractive: async (ctx: any) => await runNonInteractiveAuth(ctx, gatewayUrl),
      },
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
        methodId: "api-key",
      },
      modelPicker: {
        label: PROVIDER_LABEL,
        hint: "Connect Crm-A Cloud with your API key",
        methodId: "api-key",
      },
    },
    // Best-effort discovery so newer OpenClaw builds can rehydrate provider config.
    discovery: {
      order: "profile",
      run: async () => {
        const provider = buildDiscoveryProvider(api, gatewayUrl);
        return provider ? { provider } : null;
      },
    },
  } as any);

  registerCrmAIntegrationsBridge(api, gatewayUrl);

  // Arm the gateway-driven Gmail/Calendar sync poll trigger. Lives here
  // (not in the Next.js process) so the timer survives `crm-a-console update`
  // and web-runtime restarts. No-op when no Crm-A Cloud key is present
  // or when `syncTrigger.enabled` is explicitly disabled in plugin config.
  armSyncTrigger(api);

  // Register on-demand sync tools the agent can call when the user
  // asks for a manual refresh. Gated on the same key check as
  // `armSyncTrigger`: without a Crm-A Cloud key, the underlying
  // sync runner can't talk to Composio, so exposing the tools would
  // just produce confusing failures.
  if (typeof api?.registerTool === "function" && readCrmAAuthProfileKey()) {
    const registered = registerSyncRefreshTools(api);
    api.logger?.info?.(
      `[crm-a-ai-gateway] registered sync refresh tools: ${registered.join(", ")}`,
    );
  }

  api.registerService({
    id: "crm-a-ai-gateway",
    start: () => {
      api.logger?.info?.(`[crm-a-ai-gateway] active (gateway: ${gatewayUrl})`);
    },
    stop: () => {
      api.logger?.info?.("[crm-a-ai-gateway] stopped");
    },
  });
}
