import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/workspace", () => ({
  duckdbPathAsync: vi.fn(),
  duckdbQueryAsync: vi.fn(),
  duckdbExecOnFileAsync: vi.fn(),
}));
vi.mock("@/lib/crm-queries", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/crm-queries")>();
  return { ...original, loadCrmFieldMaps: vi.fn() };
});

const { POST } = await import("./route");
const { duckdbPathAsync, duckdbQueryAsync, duckdbExecOnFileAsync } = await import("@/lib/workspace");
const { loadCrmFieldMaps } = await import("@/lib/crm-queries");

const mockedPath = vi.mocked(duckdbPathAsync);
const mockedQuery = vi.mocked(duckdbQueryAsync);
const mockedExec = vi.mocked(duckdbExecOnFileAsync);
const mockedFieldMaps = vi.mocked(loadCrmFieldMaps);

const SECRET = "phone-secret";

function authedRequest(
  body: unknown,
  { bearer = SECRET }: { bearer?: string | null } = {},
): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (bearer !== null) {headers.Authorization = `Bearer ${bearer}`;}
  return new Request("http://localhost/api/webhooks/phone", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

const FIELD_MAPS = {
  people: {
    "Full Name": "fld_people_name",
    "Email Address": "fld_people_email",
    "Phone Number": "fld_people_phone",
    Source: "fld_people_source",
    "Preferred Contact Channel": "fld_people_pref",
    "Marketing Opt-in": "fld_people_optin",
    Notes: "fld_people_notes",
    "Last Interaction At": "fld_people_last",
  },
  company: {},
  email_thread: {},
  email_message: {},
  calendar_event: {},
  interaction: {
    Type: "fld_inter_type",
    "Occurred At": "fld_inter_occurred",
    Person: "fld_inter_person",
    Properties: "fld_inter_properties",
  },
  segment: {},
  campaign: {},
  campaign_send: {},
  product: {},
  order: {},
};

describe("/api/webhooks/phone", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRM_A_PHONE_WEBHOOK_SECRET = SECRET;
    mockedPath.mockResolvedValue("/tmp/workspace.duckdb");
    mockedFieldMaps.mockResolvedValue(FIELD_MAPS);
    mockedExec.mockResolvedValue(true);
  });

  it("401 when no secret is configured", async () => {
    delete process.env.CRM_A_PHONE_WEBHOOK_SECRET;
    const res = await POST(authedRequest({ action: "inbound", from: { phone: "+39" } }));
    expect(res.status).toBe(401);
  });

  it("401 on wrong bearer", async () => {
    const res = await POST(authedRequest({ action: "inbound" }, { bearer: "wrong" }));
    expect(res.status).toBe(401);
  });

  it("400 on unknown action", async () => {
    const res = await POST(authedRequest({ action: "nope" }));
    expect(res.status).toBe(400);
  });

  it("creates a person and returns context on inbound for an unknown number", async () => {
    mockedQuery
      .mockResolvedValueOnce([]) // findPersonIdByPhone → none
      .mockResolvedValueOnce([
        { entry_id: "person-new", name: null, email: null, phone: "+393323000000",
          status: null, preferredContact: null, marketingOptIn: null,
          notes: null, lastInteractionAt: null },
      ]); // loadPhonePerson after create

    const res = await POST(
      authedRequest({
        action: "inbound",
        callId: "call-1",
        from: { phone: "+39 332 300 0000" },
      }),
    );
    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload.matched).toBe("created");
    expect(payload.person.phone).toBe("+393323000000");
    expect(payload.context).toContain("Nuovo contatto");

    const sql = mockedExec.mock.calls.map((call) => String(call[1])).join("\n");
    expect(sql).toContain("fld_people_phone");
    expect(sql).toContain("+393323000000");
    expect(sql).toContain("Manual");
  });

  it("returns existing person context on inbound when the number is known", async () => {
    mockedQuery
      .mockResolvedValueOnce([{ entry_id: "person-123" }]) // found by phone
      .mockResolvedValueOnce([
        { entry_id: "person-123", name: "Lorenzo", email: "lorenzo@example.com",
          phone: "+393323000000", status: "Active", preferredContact: "telegram",
          marketingOptIn: "true", notes: "Interessato al Galaxy", lastInteractionAt: "2026-07-12" },
      ]);

    const res = await POST(
      authedRequest({ action: "inbound", from: { phone: "+393323000000", name: "Lorenzo" } }),
    );
    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload.matched).toBe("existing");
    expect(payload.person.name).toBe("Lorenzo");
    expect(payload.context).toContain("Lorenzo");
    expect(payload.context).toContain("telegram");
    expect(mockedExec).not.toHaveBeenCalled(); // no write on inbound-existing
  });

  it("records the call and updates the person on completed", async () => {
    mockedQuery
      .mockResolvedValueOnce([{ entry_id: "person-123" }]) // found by phone
      .mockResolvedValueOnce([{ entry_id: "person-123", name: null, email: null,
        phone: "+393323000000", status: null, preferredContact: null,
        marketingOptIn: null, notes: null, lastInteractionAt: null }]) // loadPhonePerson
      .mockResolvedValueOnce([]); // idempotency lookup → no duplicate

    const res = await POST(
      authedRequest({
        action: "completed",
        callId: "call-42",
        from: { phone: "+393323000000" },
        durationSec: 160,
        transcript: [{ speaker: "customer", text: "Buongiorno" }],
        data: {
          name: "Lorenzo",
          email: "LORENZO@Example.com",
          preferredContact: "telegram",
          marketingOptIn: true,
          summary: "Vuole avviso al lancio Galaxy",
        },
      }),
    );
    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload.ok).toBe(true);
    expect(payload.personId).toBe("person-123");
    expect(payload.actions).toContain("interaction_recorded");
    expect(payload.actions).toContain("person_updated");

    const sql = mockedExec.mock.calls.map((call) => String(call[1])).join("\n");
    // interaction Type=Custom carrying kind:Call + callId
    expect(sql).toContain("Custom");
    expect(sql).toContain('"kind":"Call"');
    expect(sql).toContain("call-42");
    expect(sql).toContain("fld_inter_person");
    // person anagraphic updated
    expect(sql).toContain("fld_people_pref");
    expect(sql).toContain("telegram");
    expect(sql).toContain("lorenzo@example.com"); // email normalized
  });

  it("ignores a duplicate completed callId without writing again", async () => {
    mockedQuery
      .mockResolvedValueOnce([{ entry_id: "person-123" }]) // found by phone
      .mockResolvedValueOnce([{ entry_id: "person-123", name: null, email: null,
        phone: "+393323000000", status: null, preferredContact: null,
        marketingOptIn: null, notes: null, lastInteractionAt: null }]) // loadPhonePerson
      .mockResolvedValueOnce([{ entry_id: "interaction-exists" }]); // idempotency hit

    const res = await POST(
      authedRequest({
        action: "completed",
        callId: "call-42",
        from: { phone: "+393323000000" },
        data: { name: "Lorenzo" },
      }),
    );
    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload.actions).toEqual(["duplicate_ignored"]);
    expect(payload.interactionId).toBe("interaction-exists");
    expect(mockedExec).not.toHaveBeenCalled();
  });

  it("resolves the person and records a Message interaction on message", async () => {
    mockedQuery
      .mockResolvedValueOnce([{ entry_id: "person-123" }]) // found by phone
      .mockResolvedValueOnce([{ entry_id: "person-123", name: "Lorenzo", email: null,
        phone: "+393323000000", status: null, preferredContact: "telegram",
        marketingOptIn: null, notes: null, lastInteractionAt: null }]);

    const res = await POST(
      authedRequest({
        action: "message",
        messageId: "tg-1",
        contact: { telegramUserId: "123", phone: "+393323000000", name: "Lorenzo" },
        text: "Mi interessa l'offerta",
      }),
    );
    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload.replyFor).toBe("message");
    expect(payload.context).toContain("Lorenzo");

    const sql = mockedExec.mock.calls.map((call) => String(call[1])).join("\n");
    expect(sql).toContain('"kind":"Message"');
    // sqlString doubles the apostrophe in the stored JSON.
    expect(sql).toContain("Mi interessa l''offerta");
  });
});
