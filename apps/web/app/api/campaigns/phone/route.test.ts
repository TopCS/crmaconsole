import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/campaign-phone", () => ({
  createPhonePearlForCampaign: vi.fn(async (_id: string, _o: string) => "pearl-1"),
  enqueuePhoneCampaign: vi.fn(async (_id: string) => ({ pearlId: "pearl-1", leadsCreated: 3, errors: [] })),
  setCampaignPearlPaused: vi.fn(async () => {}),
}));
vi.mock("@/lib/phone-webhook", () => ({
  isPhoneWebhookAuthorized: vi.fn(() => true),
  readPhoneWebhookSecret: vi.fn(() => "test-secret"),
}));
vi.mock("@/lib/public-origin", () => ({
  resolveAppPublicOrigin: vi.fn(() => "https://crm.example.net"),
}));

const { POST } = await import("./route");
const {
  createPhonePearlForCampaign,
  enqueuePhoneCampaign,
  setCampaignPearlPaused,
} = await import("@/lib/campaign-phone");
const mockedCreate = vi.mocked(createPhonePearlForCampaign);
const mockedEnqueue = vi.mocked(enqueuePhoneCampaign);
const mockedPause = vi.mocked(setCampaignPearlPaused);

const { isPhoneWebhookAuthorized } = await import("@/lib/phone-webhook");
const mockedAuth = vi.mocked(isPhoneWebhookAuthorized);

function post(body: unknown): Request {
  return new Request("http://localhost/api/campaigns/phone", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/campaigns/phone", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedAuth.mockReturnValue(true);
  });

  it("401 when not authorized", async () => {
    mockedAuth.mockReturnValue(false);
    const res = await POST(post({ action: "create", campaignId: "c1" }));
    expect(res.status).toBe(401);
  });

  it("400 on unknown action", async () => {
    const res = await POST(post({ action: "explode", campaignId: "c1" }));
    expect(res.status).toBe(400);
  });

  it("creates the Pearl and returns its id", async () => {
    const res = await POST(post({ action: "create", campaignId: "c1" }));
    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload.ok).toBe(true);
    expect(payload.pearlId).toBe("pearl-1");
    expect(mockedCreate).toHaveBeenCalledWith("c1", "https://crm.example.net");
  });

  it("enqueues leads", async () => {
    const res = await POST(post({ action: "send", campaignId: "c1" }));
    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload.leadsCreated).toBe(3);
    expect(mockedEnqueue).toHaveBeenCalledWith("c1");
  });

  it("pause and resume toggle the Pearl", async () => {
    await POST(post({ action: "pause", campaignId: "c1" }));
    expect(mockedPause).toHaveBeenCalledWith("c1", true);
    await POST(post({ action: "resume", campaignId: "c1" }));
    expect(mockedPause).toHaveBeenCalledWith("c1", false);
  });

  it("surfaces downstream errors as 500", async () => {
    mockedCreate.mockRejectedValueOnce(new Error("boom"));
    const res = await POST(post({ action: "create", campaignId: "c1" }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toContain("boom");
  });
});
