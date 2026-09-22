import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/campaigns", () => ({
  sendCampaignMultichannel: vi.fn(
    async (input: { segmentEntryId: string; preview?: boolean }) => ({
      telegram: input.preview === true ? 3 : 10,
      email: input.preview === true ? 7 : 20,
      sent: input.preview === true ? undefined : 30,
    }),
  ),
}));
vi.mock("@/lib/campaign-phone", () => ({
  resolveSegmentIdByName: vi.fn(async (name: string) => (name === "Lancio Samsung Galaxy" ? "seg-1" : null)),
}));
vi.mock("@/lib/phone-webhook", () => ({
  isPhoneWebhookAuthorized: vi.fn(() => true),
}));

const { POST } = await import("./route");
const { sendCampaignMultichannel } = await import("@/lib/campaigns");
const { resolveSegmentIdByName } = await import("@/lib/campaign-phone");
const { isPhoneWebhookAuthorized } = await import("@/lib/phone-webhook");
const mockedSend = vi.mocked(sendCampaignMultichannel);
const mockedResolve = vi.mocked(resolveSegmentIdByName);
const mockedAuth = vi.mocked(isPhoneWebhookAuthorized);

function post(body: unknown): Request {
  return new Request("http://localhost/api/campaigns/send-multichannel", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/campaigns/send-multichannel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedAuth.mockReturnValue(true);
  });

  it("401 when not authorized", async () => {
    mockedAuth.mockReturnValue(false);
    const res = await POST(post({ segmentEntryId: "s1", body: "hi" }));
    expect(res.status).toBe(401);
  });

  it("400 when segment is missing", async () => {
    const res = await POST(post({ body: "hi" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("segmentEntryId or segmentName");
  });

  it("400 when body is missing", async () => {
    const res = await POST(post({ segmentEntryId: "s1" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("body is required");
  });

  it("resolves segmentName to the segment entry id", async () => {
    const res = await POST(post({ segmentName: "Lancio Samsung Galaxy", body: "Ciao!" }));
    expect(res.status).toBe(200);
    expect(mockedResolve).toHaveBeenCalledWith("Lancio Samsung Galaxy");
    expect(mockedSend).toHaveBeenCalledWith({
      segmentEntryId: "seg-1",
      subject: "",
      body: "Ciao!",
      preview: false,
    });
  });

  it("400 when segmentName does not resolve", async () => {
    const res = await POST(post({ segmentName: "Nope", body: "Ciao!" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Segment "Nope" not found.');
    expect(mockedSend).not.toHaveBeenCalled();
  });

  it("passes preview:true through without sending", async () => {
    const res = await POST(post({ segmentEntryId: "s1", subject: "Offerta", body: "Ciao!", preview: true }));
    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload.ok).toBe(true);
    expect(payload.telegram).toBe(3);
    expect(payload.sent).toBeUndefined();
    expect(mockedSend).toHaveBeenCalledWith({
      segmentEntryId: "s1",
      subject: "Offerta",
      body: "Ciao!",
      preview: true,
    });
  });

  it("sends for real by default", async () => {
    const res = await POST(post({ segmentEntryId: "s1", body: "Ciao!" }));
    const payload = await res.json();
    expect(payload.ok).toBe(true);
    expect(payload.sent).toBe(30);
  });

  it("surfaces downstream errors as 500", async () => {
    mockedSend.mockRejectedValueOnce(new Error("boom"));
    const res = await POST(post({ segmentEntryId: "s1", body: "Ciao!" }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toContain("boom");
  });
});