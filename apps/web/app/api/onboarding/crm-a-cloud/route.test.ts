import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/crm-a-console-state", () => ({
  advanceOnboardingStep: vi.fn(() => ({ currentStep: "connect-gmail" })),
  readOnboardingState: vi.fn(() => ({ currentStep: "crm-a-cloud" })),
}));

vi.mock("@/lib/workspace", () => ({
  resolveOpenClawStateDir: vi.fn(() => "/home/testuser/.openclaw-crm-a"),
}));

vi.mock("@/lib/composio", () => ({
  resolveComposioApiKey: vi.fn(() => null),
}));

vi.mock("@/lib/crm-a-auth", () => ({
  writeCrmAAuthProfileKey: vi.fn(),
}));

vi.mock("@/lib/crm-a-cloud-settings", () => ({
  saveApiKey: vi.fn(),
  selectModel: vi.fn(),
}));

vi.mock("../../../../../../src/cli/crm-a-cloud", () => ({
  RECOMMENDED_CRM_A_CLOUD_MODEL_ID: "claude-sonnet-4.6",
  readConfiguredCrmACloudSettings: vi.fn(() => ({ selectedModel: null })),
}));

vi.mock("@/lib/telemetry", () => ({
  trackServer: vi.fn(),
}));

const { DELETE, POST } = await import("./route");
const { saveApiKey, selectModel } = await import("@/lib/crm-a-cloud-settings");
const { writeCrmAAuthProfileKey } = await import("@/lib/crm-a-auth");
const { advanceOnboardingStep } = await import("@/lib/crm-a-console-state");

const mockedSaveApiKey = vi.mocked(saveApiKey);
const mockedSelectModel = vi.mocked(selectModel);
const mockedWriteAuthProfile = vi.mocked(writeCrmAAuthProfileKey);
const mockedAdvanceOnboardingStep = vi.mocked(advanceOnboardingStep);

const refreshOk = { attempted: true, restarted: true, error: null, profile: "crm-a" };

const cloudState = {
  status: "valid" as const,
  apiKeySource: "config" as const,
  gatewayUrl: "https://gateway.merseoriginals.com",
  primaryModel: null,
  isCrmAPrimary: false,
  selectedCrmAModel: null,
  selectedVoiceId: null,
  elevenLabsEnabled: false,
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
  recommendedModelId: "claude-sonnet-4.6",
};

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/onboarding/crm-a-cloud", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Crm-A Cloud onboarding API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedSaveApiKey.mockResolvedValue({ state: cloudState, changed: true, refresh: refreshOk });
    mockedSelectModel.mockResolvedValue({ state: cloudState, changed: true, refresh: refreshOk });
  });

  it("syncs the auth profile after saving the key and selecting the model", async () => {
    const res = await POST(makeRequest({ apiKey: "crm_a_test_key" }));

    expect(res.status).toBe(200);
    expect(mockedSaveApiKey).toHaveBeenCalledWith("crm_a_test_key", { syncAuthProfile: false });
    expect(mockedSelectModel).toHaveBeenCalledWith("claude-sonnet-4.6");
    expect(mockedWriteAuthProfile).toHaveBeenCalledWith("crm_a_test_key");
  });

  it("does not write the auth profile when saving the key fails", async () => {
    mockedSaveApiKey.mockResolvedValueOnce({
      state: { ...cloudState, status: "no_key", apiKeySource: "missing", models: [] },
      changed: false,
      refresh: { attempted: false, restarted: false, error: null, profile: "default" },
      error: "Invalid Crm-A Cloud API key.",
    });

    const res = await POST(makeRequest({ apiKey: "crm_a_bad_key" }));

    expect(res.status).toBe(400);
    expect(mockedSelectModel).not.toHaveBeenCalled();
    expect(mockedWriteAuthProfile).not.toHaveBeenCalled();
  });

  it("does not write the auth profile when selecting the model fails", async () => {
    mockedSelectModel.mockResolvedValueOnce({
      state: cloudState,
      changed: false,
      refresh: { attempted: false, restarted: false, error: null, profile: "default" },
      error: "Unable to select model.",
    });

    const res = await POST(makeRequest({ apiKey: "crm_a_test_key" }));

    expect(res.status).toBe(400);
    expect(mockedWriteAuthProfile).not.toHaveBeenCalled();
  });

  it("routes users who skip Crm-A Cloud to starter skill selection", async () => {
    const res = await DELETE();

    expect(res.status).toBe(200);
    expect(mockedAdvanceOnboardingStep).toHaveBeenCalledWith(
      "crm-a-cloud",
      "skill-template",
      expect.objectContaining({
        crmACloud: expect.objectContaining({
          source: "web",
          skipped: true,
        }),
      }),
    );
  });
});
