import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const state = {
    configText: "{}\n",
    authText: null as string | null,
  };

  const catalog = {
    source: "live" as const,
    models: [
      {
        id: "crm-a-claude-sonnet",
        stableId: "claude-sonnet-4.6",
        displayName: "Claude Sonnet 4.6",
        provider: "anthropic",
        transportProvider: "crm-a-cloud",
        api: "openai-completions" as const,
        input: ["text"] as Array<"text" | "image">,
        reasoning: true,
        contextWindow: 200000,
        maxTokens: 8192,
        supportsStreaming: true,
        supportsImages: false,
        supportsResponses: true,
        supportsReasoning: true,
        cost: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
        },
      },
    ],
  };

  return {
    state,
    existsSync: vi.fn((pathLike: unknown) => {
      if (String(pathLike).endsWith("auth-profiles.json")) {
        return state.authText !== null;
      }
      return true;
    }),
    readFileSync: vi.fn((pathLike: unknown) => {
      if (String(pathLike).endsWith("auth-profiles.json")) {
        if (state.authText === null) {
          throw new Error("auth profile missing");
        }
        return state.authText as never;
      }
      return state.configText as never;
    }),
    writeFileSync: vi.fn((pathLike: unknown, content: unknown) => {
      if (String(pathLike).endsWith("openclaw.json")) {
        state.configText = String(content);
      }
      if (String(pathLike).endsWith("auth-profiles.json")) {
        state.authText = String(content);
      }
    }),
    mkdirSync: vi.fn(),
    validateCrmACloudApiKey: vi.fn(async () => undefined),
    fetchCrmACloudCatalog: vi.fn(async () => catalog),
    buildCrmACloudConfigPatch: vi.fn((params: { gatewayUrl: string; apiKey: string }) => ({
      models: {
        providers: {
          "crm-a-cloud": {
            apiKey: params.apiKey,
            baseUrl: `${params.gatewayUrl}/v1`,
          },
        },
      },
      agents: {
        defaults: {
          models: {
            "crm-a-cloud/claude-sonnet-4.6": {
              name: "Claude Sonnet 4.6",
            },
          },
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
        alsoAllow: [
          "crm_a_search_integrations",
          "crm_a_execute_integrations",
        ],
        byProvider: {
          "crm-a-cloud": {
            allow: [
              "read",
              "exec",
              "crm_a_search_integrations",
              "crm_a_execute_integrations",
            ],
          },
        },
      },
    })),
    readConfiguredCrmACloudSettings: vi.fn(() => ({
      gatewayUrl: null,
      selectedModel: null,
    })),
    ensureDefaultManagedPluginsInstalled: vi.fn(() => ({
      changed: false,
      repairs: [],
      repairedIds: [],
      state: {
        crmACloud: {
          hasKey: true,
          isPrimaryProvider: true,
          primaryModel: "crm-a-cloud/claude-sonnet-4.6",
        },
        metadata: { schemaVersion: 1 },
        search: {
          builtIn: { enabled: true, denied: false, provider: null },
          effectiveOwner: "web_search",
        },
        managedPlugins: [],
        integrations: [],
      },
    })),
    refreshIntegrationsRuntime: vi.fn(async () => ({
      attempted: true,
      restarted: true,
      error: null,
      profile: "crm-a",
    })),
  };
});

vi.mock("@/lib/workspace", () => ({
  resolveOpenClawStateDir: vi.fn(() => "/home/testuser/.openclaw-crm-a"),
}));

vi.mock("node:fs", () => ({
  existsSync: mocks.existsSync,
  readFileSync: mocks.readFileSync,
  writeFileSync: mocks.writeFileSync,
  mkdirSync: mocks.mkdirSync,
}));

vi.mock("../../../src/cli/crm-a-cloud", () => ({
  DEFAULT_CRM_A_CLOUD_GATEWAY_URL: "https://gateway.merseoriginals.com",
  normalizeCrmAGatewayUrl: (value: string) => value,
  buildCrmAGatewayApiBaseUrl: (gatewayUrl: string) => `${gatewayUrl}/v1`,
  fetchCrmACloudCatalog: mocks.fetchCrmACloudCatalog,
  validateCrmACloudApiKey: mocks.validateCrmACloudApiKey,
  buildCrmACloudConfigPatch: mocks.buildCrmACloudConfigPatch,
  readConfiguredCrmACloudSettings: mocks.readConfiguredCrmACloudSettings,
  RECOMMENDED_CRM_A_CLOUD_MODEL_ID: "claude-sonnet-4.6",
}));

vi.mock("./integrations", () => ({
  applyCrmAIntegrationToggleDraft: vi.fn(() => ({
    changed: false,
    error: null,
    metadata: { schemaVersion: 1 },
  })),
  ensureDefaultManagedPluginsInstalled: mocks.ensureDefaultManagedPluginsInstalled,
  getIntegrationsState: vi.fn(() => ({
    crmACloud: {
      hasKey: false,
      isPrimaryProvider: false,
      primaryModel: null,
    },
    metadata: { schemaVersion: 1 },
    search: {
      builtIn: { enabled: true, denied: false, provider: null },
      effectiveOwner: "web_search",
    },
    managedPlugins: [],
    integrations: [],
  })),
  readIntegrationsMetadata: vi.fn(() => ({ schemaVersion: 1 })),
  refreshIntegrationsRuntime: mocks.refreshIntegrationsRuntime,
  writeIntegrationsMetadata: vi.fn(),
}));

import {
  getCloudSettingsState,
  saveActiveCloudSettings,
  saveApiKey,
  saveVoiceId,
  selectModel,
} from "./crm-a-cloud-settings";
import {
  readIntegrationsMetadata,
  writeIntegrationsMetadata,
} from "./integrations";

describe("crm-a cloud settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readIntegrationsMetadata).mockReturnValue({ schemaVersion: 1 });
    mocks.state.configText = "{}\n";
    mocks.state.authText = null;
    mocks.validateCrmACloudApiKey.mockResolvedValue(undefined);
    mocks.fetchCrmACloudCatalog.mockResolvedValue({
      source: "live",
      models: [
        {
          id: "crm-a-claude-sonnet",
          stableId: "claude-sonnet-4.6",
          displayName: "Claude Sonnet 4.6",
          provider: "anthropic",
          transportProvider: "crm-a-cloud",
          api: "openai-completions",
          input: ["text"],
          reasoning: true,
          contextWindow: 200000,
          maxTokens: 8192,
          supportsStreaming: true,
          supportsImages: false,
          supportsResponses: true,
          supportsReasoning: true,
          cost: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
          },
        },
      ],
    });
    mocks.refreshIntegrationsRuntime.mockResolvedValue({
      attempted: true,
      restarted: true,
      error: null,
      profile: "crm-a",
    });
    mocks.ensureDefaultManagedPluginsInstalled.mockReturnValue({
      changed: false,
      repairs: [],
      repairedIds: [],
      state: {
        crmACloud: {
          hasKey: true,
          isPrimaryProvider: true,
          primaryModel: "crm-a-cloud/claude-sonnet-4.6",
        },
        metadata: { schemaVersion: 1 },
        search: {
          builtIn: { enabled: true, denied: false, provider: null },
          effectiveOwner: "web_search",
        },
        managedPlugins: [],
        integrations: [],
      },
    });
  });

  it("refreshes integrations when saving the Crm-A Cloud API key", async () => {
    const result = await saveApiKey("dc-key");

    expect(mocks.refreshIntegrationsRuntime).toHaveBeenCalledTimes(1);
    expect(mocks.ensureDefaultManagedPluginsInstalled).toHaveBeenCalledTimes(1);
    expect(result).not.toHaveProperty("toolIndexRebuild");

    const written = JSON.parse(mocks.state.configText);
    expect(written.models.providers["crm-a-cloud"].apiKey).toBe("dc-key");
    const authProfile = JSON.parse(mocks.state.authText ?? "{}");
    expect(authProfile.profiles["crm-a-cloud:default"]).toEqual({
      type: "api_key",
      provider: "crm-a-cloud",
      key: "dc-key",
    });
    expect(written.mcp).toBeUndefined();
    expect(written.tools.alsoAllow).toEqual([
      "crm_a_execute_integrations",
      "crm_a_search_integrations",
    ]);
    expect(written.tools.byProvider["crm-a-cloud"].allow).toEqual([
      "crm_a_execute_integrations",
      "crm_a_search_integrations",
      "exec",
      "read",
    ]);
    expect(written.tools.byProvider["crm-a-cloud"].profile).toBeUndefined();
    expect(written.tools.byProvider["crm-a-cloud"].alsoAllow).toBeUndefined();
  });

  it("preserves unrelated auth profiles when saving the Crm-A Cloud API key", async () => {
    mocks.state.authText = JSON.stringify({
      version: 1,
      profiles: {
        "other-provider:default": {
          type: "api_key",
          provider: "other-provider",
          key: "keep-me",
        },
        "crm-a-cloud:default": {
          type: "api_key",
          provider: "crm-a-cloud",
          key: "old-key",
        },
      },
    });

    await saveApiKey("new-key");

    const authProfile = JSON.parse(mocks.state.authText ?? "{}");
    expect(authProfile.profiles["other-provider:default"]).toEqual({
      type: "api_key",
      provider: "other-provider",
      key: "keep-me",
    });
    expect(authProfile.profiles["crm-a-cloud:default"]).toEqual({
      type: "api_key",
      provider: "crm-a-cloud",
      key: "new-key",
    });
  });

  it("does not write the auth profile when API key validation fails", async () => {
    const existingAuthProfile = JSON.stringify({
      version: 1,
      profiles: {
        "crm-a-cloud:default": {
          type: "api_key",
          provider: "crm-a-cloud",
          key: "old-key",
        },
      },
    });
    mocks.state.authText = existingAuthProfile;
    mocks.validateCrmACloudApiKey.mockRejectedValueOnce(new Error("Invalid Crm-A Cloud API key."));

    const result = await saveApiKey("bad-key");

    expect(result.error).toBe("Invalid Crm-A Cloud API key.");
    expect(mocks.validateCrmACloudApiKey).toHaveBeenCalledTimes(1);
    expect(mocks.state.authText).toBe(existingAuthProfile);
    expect(mocks.refreshIntegrationsRuntime).not.toHaveBeenCalled();
  });

  it("returns invalid-key state without re-validating when API key validation fails", async () => {
    mocks.validateCrmACloudApiKey.mockRejectedValueOnce(
      new Error("Could not reach Crm-A Cloud gateway at https://gateway.example.com/v1 (fetch failed)."),
    );

    const result = await saveApiKey("bad-key");

    expect(mocks.validateCrmACloudApiKey).toHaveBeenCalledTimes(1);
    expect(result.state.status).toBe("invalid_key");
    expect(result.state.validationError).toContain("Could not reach Crm-A Cloud gateway");
    expect(result.error).toContain("Could not reach Crm-A Cloud gateway");
  });

  it("refreshes integrations when switching the primary model to Crm-A Cloud", async () => {
    mocks.state.configText = JSON.stringify({
      models: {
        providers: {
          "crm-a-cloud": {
            apiKey: "dc-key",
          },
        },
      },
    });
    const result = await selectModel("claude-sonnet-4.6");

    expect(mocks.refreshIntegrationsRuntime).toHaveBeenCalledTimes(1);
    expect(result).not.toHaveProperty("toolIndexRebuild");

    const written = JSON.parse(mocks.state.configText);
    expect(written.agents.defaults.model.primary).toBe("crm-a-cloud/claude-sonnet-4.6");
    expect(written.mcp).toBeUndefined();
    expect(written.tools.alsoAllow).toEqual([
      "crm_a_execute_integrations",
      "crm_a_search_integrations",
    ]);
    expect(written.tools.byProvider["crm-a-cloud"].allow).toEqual([
      "crm_a_execute_integrations",
      "crm_a_search_integrations",
      "exec",
      "read",
    ]);
    expect(written.tools.byProvider["crm-a-cloud"].profile).toBeUndefined();
    expect(written.tools.byProvider["crm-a-cloud"].alsoAllow).toBeUndefined();
  });

  it("preserves a stored voiceId without re-enabling ElevenLabs during model changes", async () => {
    mocks.state.configText = JSON.stringify({
      models: {
        providers: {
          "crm-a-cloud": {
            apiKey: "dc-key",
          },
        },
      },
      messages: {
        tts: {
          providers: {
            elevenlabs: {
              voiceId: "voice_123",
            },
          },
        },
      },
    });

    await selectModel("claude-sonnet-4.6");

    const written = JSON.parse(mocks.state.configText);
    expect(written.messages.tts.provider).toBeUndefined();
    expect(written.messages.tts.providers.elevenlabs).toEqual({
      voiceId: "voice_123",
    });
    expect(written.messages.tts.elevenlabs).toBeUndefined();
  });

  it("stores the selected ElevenLabs voice without restarting the gateway", async () => {
    const result = await saveVoiceId("voice_456");

    expect(result.changed).toBe(true);
    expect(result.refresh).toEqual({
      attempted: false,
      restarted: false,
      error: null,
      profile: "default",
    });

    const written = JSON.parse(mocks.state.configText);
    expect(written.messages.tts.providers.elevenlabs.voiceId).toBe("voice_456");
  });

  it("strips legacy enrichment max-mode metadata when saving active settings", async () => {
    vi.mocked(readIntegrationsMetadata).mockReturnValue({
      schemaVersion: 1,
      apollo: { enrichmentMaxMode: true } as never,
    });
    mocks.state.configText = JSON.stringify({
      models: {
        providers: {
          "crm-a-cloud": {
            apiKey: "dc-key",
            enrichmentMaxMode: true,
          },
        },
      },
    });

    const result = await saveActiveCloudSettings({
      stableId: null,
      voiceId: null,
      integrations: {},
    });

    expect(result.changed).toBe(true);
    expect(writeIntegrationsMetadata).toHaveBeenCalledWith({
      schemaVersion: 1,
      apollo: {},
    });
    const written = JSON.parse(mocks.state.configText);
    expect(written.models.providers["crm-a-cloud"].enrichmentMaxMode).toBeUndefined();
  });
});
