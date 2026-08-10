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
  normalizePhone: (v: unknown) => (typeof v === "string" ? v.replace(/[\s\-().]/g, "") : ""),
  recordEvent: vi.fn(),
  findPersonIdByPhone: vi.fn(),
  createPersonFromPhone: vi.fn(),
  updatePersonFields: vi.fn(async () => true),
}));
vi.mock("@/lib/phone-webhook", () => ({
  readPhoneWebhookSecret: vi.fn(() => "test-secret"),
}));

const { POST } = await import("./route");
const { duckdbQueryAsync } = await import("@/lib/workspace");
const { loadCrmFieldMaps } = await import("@/lib/crm-queries");
const { recordEvent, findPersonIdByPhone, createPersonFromPhone, updatePersonFields } = await import("@/lib/events");
const mockedQuery = vi.mocked(duckdbQueryAsync);
const mockedFieldMaps = vi.mocked(loadCrmFieldMaps);
const mockedRecordEvent = vi.mocked(recordEvent);
const mockedFindByPhone = vi.mocked(findPersonIdByPhone);
const mockedCreatePhone = vi.mocked(createPersonFromPhone);
const mockedUpdate = vi.mocked(updatePersonFields);

function post(channel: string, body: unknown, token = "test-secret"): Request {
  const url = token
    ? `http://localhost/api/nlpearl/webhook/${channel}?token=${encodeURIComponent(token)}`
    : `http://localhost/api/nlpearl/webhook/${channel}`;
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function call(channel: string, body: unknown, token?: string): Promise<Response> {
  return POST(post(channel, body, token), { params: Promise.resolve({ channel }) });
}

const CALCALL = {
  id: "call-42",
  pearlId: "p1",
  startTime: "2026-08-01T10:00:00Z",
  conversationStatus: "Success" as const,
  status: "Completed" as const,
  from: "+393312345678",
  to: "+3902123456",
  name: "Lorenzo",
  duration: 142,
  summary: "Acquisto confermato",
};

const LEAPLOAD = {
  id: "lead-9",
  pearlId: "p1",
  externalId: "campaign_send_1",
  phoneNumber: "+393312345678",
  status: "Success" as const,
  callData: { firstName: "Lorenzo" },
};

describe("POST /api/nlpearl/webhook/:channel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedFieldMaps.mockResolvedValue({
      interaction: {
        Type: "fl_type",
        "Occurred At": "fl_occur",
        Person: "fl_person",
        Properties: "fl_props",
      },
      people: { "Phone Number": "fl_phone", Source: "fl_src", "Full Name": "fl_name", "Last Interaction At": "fl_last" },
    } as never);
    mockedQuery.mockResolvedValue([]); // no duplicate
    mockedFindByPhone.mockResolvedValue("person-1");
    mockedRecordEvent.mockResolvedValue({ eventId: "ev-1" });
  });

  it("401 on missing token", async () => {
    const res = await call("call", CALCALL, null);
    expect(res.status).toBe(401);
  });

  it("401 on wrong token", async () => {
    const res = await call("call", CALCALL, "wrong");
    expect(res.status).toBe(401);
  });

  it("400 on unknown channel", async () => {
    const res = await call("xyz", {});
    expect(res.status).toBe(400);
  });

  it("records a Call interaction and updates last interaction for the person", async () => {
    const res = await call("call", CALCALL);
    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload.ok).toBe(true);
    expect(payload.interactionId).toBe("ev-1");
    expect(mockedRecordEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "Call", personId: "person-1" }),
    );
    expect(mockedUpdate).toHaveBeenCalledWith("person-1", [["Last Interaction At", expect.any(String)]]);
  });

  it("creates the person when the phone number is unknown", async () => {
    mockedFindByPhone.mockResolvedValue(null);
    mockedCreatePhone.mockResolvedValue("person-new");
    const res = await call("call", { ...CALCALL, name: "Lorenzo" });
    expect(res.status).toBe(200);
    expect(mockedCreatePhone).toHaveBeenCalledWith("+393312345678", "Lorenzo");
  });

  it("skips duplicate call events (idempotency)", async () => {
    mockedQuery.mockResolvedValue([{ entry_id: "ev-exists" }]);
    const res = await call("call", CALCALL);
    const payload = await res.json();
    expect(payload.duplicate).toBe(true);
    expect(mockedRecordEvent).not.toHaveBeenCalled();
  });

  it("records a Lead status change interaction", async () => {
    const res = await call("lead", LEAPLOAD);
    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload.ok).toBe(true);
    expect(payload.sendStatus).toBe("Sent");
    expect(mockedRecordEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "Custom" }),
    );
  });
});
