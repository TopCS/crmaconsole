import { afterEach, describe, expect, it, vi } from "vitest";
import { buildCrmACloudConfigPatch as buildRuntimePluginConfigPatch } from "../../extensions/crm-a-ai-gateway/index.js";
import {
  buildCrmACloudConfigPatch,
  fetchCrmACloudCatalog,
  normalizeCrmACloudCatalogResponse,
  readConfiguredCrmACloudSettings,
  validateCrmACloudApiKey,
} from "./crm-a-cloud.js";

function createJsonResponse(params?: { status?: number; payload?: unknown }): Response {
  const status = params?.status ?? 200;
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => params?.payload ?? {},
  } as unknown as Response;
}

describe("crm-a-cloud helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("normalizes the public gateway catalog into stable model records", () => {
    const models = normalizeCrmACloudCatalogResponse({
      object: "list",
      data: [
        {
          id: "gpt-5.4",
          stableId: "gpt-5.4",
          name: "GPT-5.4",
          provider: "openai",
          transportProvider: "openai",
          input: ["text", "image"],
          contextWindow: 128000,
          maxTokens: 128000,
          supportsStreaming: true,
          supportsImages: true,
          supportsResponses: true,
          supportsReasoning: false,
          cost: {
            input: 3.375,
            output: 20.25,
            cacheRead: 0,
            cacheWrite: 0,
            marginPercent: 0.35,
          },
        },
      ],
    });

    expect(models).toEqual([
      expect.objectContaining({
        id: "gpt-5.4",
        stableId: "gpt-5.4",
        displayName: "GPT-5.4",
        contextWindow: 128000,
        maxTokens: 128000,
        cost: {
          input: 3.375,
          output: 20.25,
          cacheRead: 0,
          cacheWrite: 0,
        },
      }),
    ]);
    expect(models[0]?.cost).not.toHaveProperty("marginPercent");
  });

  it("falls back to the bundled model list when the public catalog is unavailable", async () => {
    const fetchMock = vi.fn(async () => createJsonResponse({ status: 503, payload: {} }));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const result = await fetchCrmACloudCatalog("https://gateway.merseoriginals.com");
    expect(fetchMock).toHaveBeenCalledWith("https://gateway.merseoriginals.com/v1/public/models");
    expect(result.source).toBe("fallback");
    expect(result.models.map((model) => model.stableId)).toEqual([
      "moonshotai.kimi-k2.5",
      "anthropic.claude-opus-4-6-v1",
      "gpt-5.4",
      "anthropic.claude-sonnet-4-6-v1",
    ]);
  });

  it("rejects invalid Crm-A Cloud API keys with an actionable message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        createJsonResponse({ status: 401, payload: {} }),
      ) as unknown as typeof fetch,
    );

    await expect(
      validateCrmACloudApiKey("https://gateway.merseoriginals.com", "bad-key"),
    ).rejects.toThrow("Check your key at dench.com/settings");
  });

  it("surfaces network failures during API key validation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }) as unknown as typeof fetch,
    );

    await expect(
      validateCrmACloudApiKey("https://gateway.merseoriginals.com", "crm_a_test_key"),
    ).rejects.toThrow("Could not reach Crm-A Cloud gateway");
  });

  it("builds the Crm-A Cloud config patch with provider models, agent aliases, and Crm-A Integrations tools", () => {
    const patch = buildCrmACloudConfigPatch({
      gatewayUrl: "https://gateway.merseoriginals.com",
      apiKey: "crm_a_live_key",
      models: [
        {
          id: "claude-opus-4.6",
          stableId: "anthropic.claude-opus-4-6-v1",
          displayName: "Claude Opus 4.6",
          provider: "anthropic",
          transportProvider: "bedrock",
          api: "openai-responses",
          input: ["text", "image"],
          reasoning: false,
          contextWindow: 200000,
          maxTokens: 64000,
          supportsStreaming: true,
          supportsImages: true,
          supportsResponses: true,
          supportsReasoning: false,
          cost: {
            input: 6.75,
            output: 33.75,
            cacheRead: 0,
            cacheWrite: 0,
          },
        },
      ],
    });

    expect(patch.models.providers["crm-a-cloud"]).toEqual(
      expect.objectContaining({
        baseUrl: "https://gateway.merseoriginals.com/v1",
        apiKey: "crm_a_live_key",
        api: "openai-responses",
        models: [
          expect.objectContaining({
            id: "anthropic.claude-opus-4-6-v1",
            name: "Claude Opus 4.6 (Crm-A Cloud)",
          }),
        ],
      }),
    );
    expect(patch.agents.defaults.models["crm-a-cloud/anthropic.claude-opus-4-6-v1"]).toEqual(
      expect.objectContaining({
        alias: "Claude Opus 4.6 (Crm-A Cloud)",
      }),
    );
    expect(patch.messages.tts.provider).toBe("elevenlabs");
    expect(patch.messages.tts.providers.elevenlabs).toEqual({
      baseUrl: "https://gateway.merseoriginals.com",
      apiKey: "crm_a_live_key",
    });
    expect((patch.messages.tts as Record<string, unknown>).elevenlabs).toBeUndefined();
    expect((patch as Record<string, unknown>).mcp).toBeUndefined();
    expect(patch.tools.alsoAllow).toEqual([
      "crm_a_search_integrations",
      "crm_a_execute_integrations",
    ]);
    expect(patch.tools.byProvider["crm-a-cloud"].allow).toContain("read");
    expect(patch.tools.byProvider["crm-a-cloud"].allow).toContain("exec");
    expect(patch.tools.byProvider["crm-a-cloud"].allow).toContain("crm_a_search_integrations");
    expect(patch.tools.byProvider["crm-a-cloud"].allow).not.toContain("bundle-mcp");
  });

  it("keeps the runtime plugin patch in parity with the CLI/web helper", () => {
    const params = {
      gatewayUrl: "https://gateway.merseoriginals.com",
      apiKey: "crm_a_live_key",
      models: [
        {
          id: "claude-opus-4.6",
          stableId: "anthropic.claude-opus-4-6-v1",
          displayName: "Claude Opus 4.6",
          provider: "anthropic",
          transportProvider: "bedrock",
          api: "openai-responses" as const,
          input: ["text" as const, "image" as const],
          reasoning: false,
          contextWindow: 200000,
          maxTokens: 64000,
          supportsStreaming: true,
          supportsImages: true,
          supportsResponses: true,
          supportsReasoning: false,
          cost: {
            input: 6.75,
            output: 33.75,
            cacheRead: 0,
            cacheWrite: 0,
          },
        },
      ],
    };

    expect(buildRuntimePluginConfigPatch(params)).toEqual(buildCrmACloudConfigPatch(params));
  });

  it("reads existing Crm-A Cloud gateway config from openclaw.json", () => {
    const result = readConfiguredCrmACloudSettings({
      models: {
        providers: {
          "crm-a-cloud": {
            baseUrl: "https://gateway.merseoriginals.com/v1",
            apiKey: "crm_a_cfg_key",
          },
        },
      },
      agents: {
        defaults: {
          model: {
            primary: "crm-a-cloud/anthropic.claude-opus-4-6-v1",
          },
        },
      },
    });

    expect(result).toEqual({
      gatewayUrl: "https://gateway.merseoriginals.com",
      apiKey: "crm_a_cfg_key",
      selectedModel: "anthropic.claude-opus-4-6-v1",
      ttsElevenLabsBaseUrl: undefined,
    });
  });

  it("reads existing TTS ElevenLabs baseUrl from openclaw.json", () => {
    const result = readConfiguredCrmACloudSettings({
      models: {
        providers: {
          "crm-a-cloud": {
            baseUrl: "https://gateway.merseoriginals.com/v1",
            apiKey: "crm_a_cfg_key",
          },
        },
      },
      agents: {
        defaults: {
          model: {
            primary: "crm-a-cloud/gpt-5.4",
          },
        },
      },
      messages: {
        tts: {
          provider: "elevenlabs",
          providers: {
            elevenlabs: {
              baseUrl: "https://gateway.merseoriginals.com",
              apiKey: "crm_a_cfg_key",
            },
          },
        },
      },
    });

    expect(result.ttsElevenLabsBaseUrl).toBe("https://gateway.merseoriginals.com");
  });

  it("reads legacy flat TTS ElevenLabs config from openclaw.json", () => {
    const result = readConfiguredCrmACloudSettings({
      models: {
        providers: {
          "crm-a-cloud": {
            baseUrl: "https://gateway.merseoriginals.com/v1",
            apiKey: "crm_a_cfg_key",
          },
        },
      },
      agents: {
        defaults: {
          model: {
            primary: "crm-a-cloud/gpt-5.4",
          },
        },
      },
      messages: {
        tts: {
          provider: "elevenlabs",
          elevenlabs: {
            baseUrl: "https://gateway.merseoriginals.com",
            apiKey: "crm_a_cfg_key",
          },
        },
      },
    });

    expect(result.ttsElevenLabsBaseUrl).toBe("https://gateway.merseoriginals.com");
  });
});
