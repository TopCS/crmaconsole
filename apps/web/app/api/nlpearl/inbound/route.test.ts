import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/nlpearl", () => ({
  resolvePearlIdByName: vi.fn(async (name: string) => (name === "Customer Care" ? "pearl-inbound-1" : "pearl-unknown")),
  setPearlActive: vi.fn(async () => {}),
}));
vi.mock("@/lib/nlpearl-inbound", () => ({
  createInboundPearl: vi.fn(async () => "pearl-created"),
}));
vi.mock("@/lib/phone-webhook", () => ({
  isPhoneWebhookAuthorized: vi.fn(() => true),
}));
vi.mock("@/lib/public-origin", () => ({
  resolveAppPublicOrigin: vi.fn(() => "https://crm.example.net"),
}));

const { POST } = await import("./route");
const { resolvePearlIdByName, setPearlActive } = await import("@/lib/nlpearl");
const { isPhoneWebhookAuthorized } = await import("@/lib/phone-webhook");
const mockedResolve = vi.mocked(resolvePearlIdByName);
const mockedActive = vi.mocked(setPearlActive);
const mockedAuth = vi.mocked(isPhoneWebhookAuthorized);

function post(body: unknown): Request {
  return new Request("http://localhost/api/nlpearl/inbound", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/nlpearl/inbound", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedAuth.mockReturnValue(true);
  });

  it("401 when not authorized", async () => {
    mockedAuth.mockReturnValue(false);
    const res = await POST(post({ action: "activate", pearlId: "p-1" }));
    expect(res.status).toBe(401);
  });

  it("activates an existing Pearl by NAME", async () => {
    const res = await POST(post({ action: "activate", pearlName: "Customer Care" }));
    expect(res.status).toBe(200);
    expect(mockedResolve).toHaveBeenCalledWith("Customer Care", { kind: "inbound" });
    expect(mockedActive).toHaveBeenCalledWith("pearl-inbound-1", true);
    expect((await res.json()).active).toBe(true);
  });

  it("pauses by pearlId directly", async () => {
    const res = await POST(post({ action: "pause", pearlId: "pearl-9" }));
    expect(res.status).toBe(200);
    expect(mockedActive).toHaveBeenCalledWith("pearl-9", false);
  });

  it("400 when activate/pause has neither pearlId nor pearlName", async () => {
    const res = await POST(post({ action: "activate" }));
    expect(res.status).toBe(400);
  });
});