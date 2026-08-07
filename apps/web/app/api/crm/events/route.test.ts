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

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/api/crm/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const FIELD_MAPS = {
  people: {
    "Full Name": "fld_people_name",
    "Email Address": "fld_people_email",
    Source: "fld_people_source",
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

describe("/api/crm/events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedPath.mockResolvedValue("/tmp/workspace.duckdb");
    mockedFieldMaps.mockResolvedValue(FIELD_MAPS);
    mockedExec.mockResolvedValue(true);
  });

  it("rejects an unknown event type", async () => {
    const res = await POST(jsonRequest({ personEmail: "a@b.co", type: "Scroll" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("Scroll");
  });

  it("rejects when neither personId nor personEmail is provided", async () => {
    const res = await POST(jsonRequest({ type: "Page View" }));
    expect(res.status).toBe(400);
  });

  it("creates the person when the email is unknown, then records the event", async () => {
    mockedQuery.mockResolvedValue([]); // no existing person

    const res = await POST(
      jsonRequest({
        personEmail: "New@Example.com",
        type: "Page View",
        properties: { url: "/pricing" },
      }),
    );

    expect(res.status).toBe(201);
    const payload = await res.json();
    expect(payload.createdPerson).toBe(true);
    expect(payload.personId).toBeTruthy();
    expect(payload.eventId).toBeTruthy();

    // Person lookup happened with the lowercased email.
    expect(mockedQuery).toHaveBeenCalledWith(expect.stringContaining("new@example.com"));

    const sql = mockedExec.mock.calls.map((call) => String(call[1])).join("\n");
    // Person created with Source=Manual…
    expect(sql).toContain("fld_people_source");
    expect(sql).toContain("Manual");
    // …and the event carries type, person and JSON properties.
    expect(sql).toContain("fld_inter_type");
    expect(sql).toContain("Page View");
    expect(sql).toContain("fld_inter_properties");
    expect(sql).toContain("/pricing");
  });

  it("reuses the existing person when the email is known", async () => {
    mockedQuery.mockResolvedValue([{ entry_id: "person-123" }]);

    const res = await POST(jsonRequest({ personEmail: "ada@example.com", type: "Purchase" }));

    expect(res.status).toBe(201);
    const payload = await res.json();
    expect(payload.createdPerson).toBe(false);
    expect(payload.personId).toBe("person-123");

    const sql = mockedExec.mock.calls.map((call) => String(call[1])).join("\n");
    expect(sql).not.toContain("fld_people_source");
    expect(sql).toContain("person-123");
    expect(sql).toContain("Purchase");
  });

  it("404s when personId does not exist", async () => {
    mockedQuery.mockResolvedValue([]);
    const res = await POST(jsonRequest({ personId: "missing", type: "Custom" }));
    expect(res.status).toBe(404);
  });
});
