import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/workspace", () => ({
  duckdbQueryAsync: vi.fn(),
  duckdbExecOnFileAsync: vi.fn(async () => true),
  duckdbPathAsync: vi.fn(async () => "/tmp/workspace.duckdb"),
}));
vi.mock("@/lib/crm-queries", () => ({
  loadCrmFieldMaps: vi.fn(),
  sqlString: (v: string) => `'${v.replace(/'/g, "''")}'`,
}));
vi.mock("@/lib/nlpearl-status", () => ({
  classifyCallConversationStatus: (s: string) =>
    s === "Success" ? "success" : s === "NotSuccessful" ? "contacted" : "failed",
  mapNlpearlLeadStatus: (s: string) => (s === "Success" ? "Sent" : "Queued"),
}));
vi.mock("@/lib/events", () => ({
  normalizePhone: (v: unknown) => (typeof v === "string" ? v.trim() : ""),
  recordEvent: vi.fn(),
  findPersonIdByPhone: vi.fn(),
  createPersonFromPhone: vi.fn(),
  updatePersonFields: vi.fn(async () => true),
}));
vi.mock("@/lib/phone-webhook", () => ({
  readPhoneWebhookSecret: vi.fn(() => "test-secret"),
}));
vi.mock("@/lib/campaign-phone", () => ({
  updateCampaignSendByExternalId: vi.fn(async () => true),
}));

const { POST } = await import("./route");
const { duckdbQueryAsync } = await import("@/lib/workspace");
const { loadCrmFieldMaps } = await import("@/lib/crm-queries");
const { recordEvent, findPersonIdByPhone, createPersonFromPhone, updatePersonFields } = await import("@/lib/events");
const { updateCampaignSendByExternalId } = await import("@/lib/campaign-phone");

const mockedQuery = vi.mocked(duckdbQueryAsync);
const mockedFieldMaps = vi.mocked(loadCrmFieldMaps);
const mockedRecordEvent = vi.mocked(recordEvent);
const mockedFindByPhone = vi.mocked(findPersonIdByPhone);
const mockedCreatePhone = vi.mocked(createPersonFromPhone);
const mockedUpdate = vi.mocked(updatePersonFields);
const mockedCampaignUpdate = vi.mocked(updateCampaignSendByExternalId);

function post(channel: string, body: unknown, token: string | null = "test-secret"): Request {
  const q = token ? `?token=${encodeURIComponent(token)}` : "";
  return new Request(`http://localhost/api/nlpearl/webhook/${channel}${q}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
}
async function call(ch: string, b: unknown, t?: string | null) {
  return POST(post(ch, b, t as string | null), { params: Promise.resolve({ channel: ch }) });
}
const fl = {
  interaction: { Type: "fl_t", "Occurred At": "fl_o", Person: "fl_p", Properties: "fl_pr" },
  people: { "Phone Number": "fl_pn", Source: "fl_s", "Full Name": "fl_n", "Last Interaction At": "fl_l" },
} as never;

const CALCALL = {
  id: "c1", pearlId: "p1", startTime: "2026-01-01T00:00:00Z",
  conversationStatus: "Success" as const, status: "Completed" as const,
  from: "+393312345678", to: "+3902", name: "Lorenzo", duration: 100, summary: "ok",
};
const LEAPLOAD = {
  id: "l1", pearlId: "p1", externalId: "snd-1", phoneNumber: "+393312345678",
  status: "Success" as const, callData: { firstName: "Lorenzo" },
};

describe("POST /api/nlpearl/webhook/:channel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedFieldMaps.mockResolvedValue(fl);
    mockedQuery.mockResolvedValue([]);
    mockedFindByPhone.mockResolvedValue("person-1");
    mockedRecordEvent.mockResolvedValue({ eventId: "ev-1" });
  });

  it("401 missing token", async () => { expect((await call("call", CALCALL, null)).status).toBe(401); });
  it("401 wrong token", async () => { expect((await call("call", CALCALL, "wrong")).status).toBe(401); });
  it("400 unknown channel", async () => { expect((await call("x", {})).status).toBe(400); });

  it("call → interaction + persona", async () => {
    const r = await call("call", CALCALL);
    const p = await r.json();
    expect(p.ok).toBe(true);
    expect(p.interactionId).toBe("ev-1");
    expect(mockedRecordEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "Call" }));
    expect(mockedUpdate).toHaveBeenCalledWith("person-1", [["Last Interaction At", expect.any(String)]]);
  });

  it("call → crea persona", async () => {
    mockedFindByPhone.mockResolvedValue(null);
    mockedCreatePhone.mockResolvedValue("person-new");
    const r = await call("call", { ...CALCALL, name: "Lorenzo" });
    expect(r.status).toBe(200);
    expect(mockedCreatePhone).toHaveBeenCalledWith("+393312345678", "Lorenzo");
  });

  it("call → idempotent", async () => {
    mockedQuery.mockResolvedValue([{ entry_id: "dup" }]);
    const p = await (await call("call", CALCALL)).json();
    expect(p.duplicate).toBe(true);
    expect(mockedRecordEvent).not.toHaveBeenCalled();
  });

  it("lead → interaction + campaign_send update", async () => {
    const p = await (await call("lead", LEAPLOAD)).json();
    expect(p.ok).toBe(true);
    expect(p.sendStatus).toBe("Sent");
    expect(mockedCampaignUpdate).toHaveBeenCalledWith("snd-1", "Sent");
  });
});
