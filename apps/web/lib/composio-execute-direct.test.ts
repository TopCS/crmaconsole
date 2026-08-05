import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/composio", () => ({
  resolveComposioApiKey: vi.fn(() => "cloud-key"),
  resolveComposioGatewayUrl: vi.fn(() => "https://gateway.example.com"),
}));
vi.mock("@/lib/composio-direct", () => ({
  resolveDirectComposioApiKey: vi.fn(),
  directComposioFetch: vi.fn(),
}));

const { executeComposioTool } = await import("./composio-execute");
const { resolveDirectComposioApiKey, directComposioFetch } = await import("@/lib/composio-direct");

const mockedDirectKey = vi.mocked(resolveDirectComposioApiKey);
const mockedDirectFetch = vi.mocked(directComposioFetch);

describe("executeComposioTool direct mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedDirectKey.mockReturnValue("direct-key");
  });

  it("unwraps the v3.1 { data, error, successful } envelope", async () => {
    mockedDirectFetch.mockResolvedValue(
      new Response(JSON.stringify({ data: { profile: "ok" }, error: null, successful: true })),
    );

    const result = await executeComposioTool<{ profile: string }>({
      toolSlug: "GMAIL_GET_PROFILE",
      connectedAccountId: "ca_1",
      arguments: {},
    });

    expect(result.data).toEqual({ profile: "ok" });
    const [url, init] = mockedDirectFetch.mock.calls[0];
    expect(String(url)).toContain("/api/v3.1/tools/execute/GMAIL_GET_PROFILE");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      connected_account_id: "ca_1",
      arguments: {},
    });
  });

  it("throws when the v3.1 envelope reports failure", async () => {
    mockedDirectFetch.mockResolvedValue(
      new Response(JSON.stringify({ data: {}, error: "invalid_grant", successful: false })),
    );

    await expect(
      executeComposioTool({ toolSlug: "GMAIL_X", connectedAccountId: "ca_1", arguments: {} }),
    ).rejects.toThrow("invalid_grant");
  });
});
