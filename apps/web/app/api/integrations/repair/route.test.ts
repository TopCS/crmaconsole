import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/integrations", () => ({
  repairManagedPluginsProfile: vi.fn(() => ({
    changed: true,
    repairs: [
      {
        id: "crm-a-ai-gateway",
        pluginId: "crm-a-ai-gateway",
        assetAvailable: true,
        assetCopied: true,
        repaired: true,
        issues: [],
      },
    ],
    repairedIds: ["crm-a-ai-gateway"],
    state: {
      crmACloud: {
        hasKey: true,
        isPrimaryProvider: true,
        primaryModel: "crm-a-cloud/claude-sonnet-4.6",
      },
      metadata: { schemaVersion: 1, exa: { ownsSearch: false, fallbackProvider: "duckduckgo" } },
      search: {
        builtIn: {
          enabled: true,
          denied: false,
          provider: "duckduckgo",
        },
        effectiveOwner: "web_search",
      },
      managedPlugins: [],
      integrations: [],
    },
  })),
  refreshIntegrationsRuntime: vi.fn(() => Promise.resolve({
    attempted: true,
    restarted: true,
    error: null,
    profile: "crm-a",
  })),
}));

describe("integrations repair API", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("repairs older profiles and reports restart status", async () => {
    const { POST } = await import("./route.js");
    const response = await POST();
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.changed).toBe(true);
    expect(json.repairedIds).toEqual(["crm-a-ai-gateway"]);
    expect(json.refresh.restarted).toBe(true);
  });
});
