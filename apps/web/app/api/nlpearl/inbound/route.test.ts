import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/nlpearl-inbound", () => ({
  createInboundPearl: vi.fn(async () => "inbound-pearl-1"),
}));
vi.mock("@/lib/nlpearl", () => ({
  setPearlActive: vi.fn(async () => undefined),
}));
vi.mock("@/lib/phone-webhook", () => ({
  isPhoneWebhookAuthorized: vi.fn(() => true),
}));
vi.mock("@/lib/public-origin", () => ({
  resolveAppPublicOrigin: () => "https://crm.example.net",
}));

const { POST } = await import("./route");
const { createInboundPearl } = await import("@/lib/nlpearl-inbound");
const { setPearlActive } = await import("@/lib/nlpearl");
const mockedCreate = vi.mocked(createInboundPearl);
const mockedSetActive = vi.mocked(setPearlActive);

function post(body: unknown): Request {
  return new Request("http://localhost/api/nlpearl/inbound", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/nlpearl/inbound", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates the inbound Pearl with name/phone/brief from the public origin", async () => {
    const res = await POST(post({ name: "Care", phoneId: "pn-1", brief: "## Offerta Galaxy" }));
    expect(res.status).toBe(200);
    expect((await res.json()).pearlId).toBe("inbound-pearl-1");
    expect(mockedCreate).toHaveBeenCalledWith({
      origin: "https://crm.example.net",
      name: "Care",
      phoneId: "pn-1",
      brief: "## Offerta Galaxy",
    });
  });

  it("defaults the name when omitted", async () => {
    await POST(post({}));
    expect(mockedCreate).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Customer Care" }),
    );
  });

  it("401 without auth", async () => {
    const { isPhoneWebhookAuthorized } = await import("@/lib/phone-webhook");
    vi.mocked(isPhoneWebhookAuthorized).mockReturnValueOnce(false);
    const res = await POST(post({ name: "Care" }));
    expect(res.status).toBe(401);
  });

  it("500 on downstream failure", async () => {
    mockedCreate.mockRejectedValueOnce(new Error("boom"));
    const res = await POST(post({ name: "Care" }));
    expect(res.status).toBe(500);
  });

  it("activate calls setPearlActive(true)", async () => {
    const res = await POST(post({ action: "activate", pearlId: "pearl-9" }));
    expect(res.status).toBe(200);
    expect((await res.json()).active).toBe(true);
    expect(mockedSetActive).toHaveBeenCalledWith("pearl-9", true);
  });

  it("pause calls setPearlActive(false)", async () => {
    const res = await POST(post({ action: "pause", pearlId: "pearl-9" }));
    expect(res.status).toBe(200);
    expect((await res.json()).active).toBe(false);
    expect(mockedSetActive).toHaveBeenCalledWith("pearl-9", false);
  });

  it("activate/pause require pearlId", async () => {
    const res = await POST(post({ action: "activate" }));
    expect(res.status).toBe(400);
  });

  it("500 when activation fails", async () => {
    mockedSetActive.mockRejectedValueOnce(new Error("boom"));
    const res = await POST(post({ action: "activate", pearlId: "pearl-9" }));
    expect(res.status).toBe(500);
  });
});