import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tracking", () => ({
  isValidTrackingWriteKey: vi.fn(),
}));
vi.mock("@/lib/events", () => ({
  normalizeEmail: (v: unknown) => (typeof v === "string" ? v.trim().toLowerCase() : ""),
  findPersonIdByEmail: vi.fn(),
  findPersonIdByAnonymousId: vi.fn(),
  createPersonFromEmail: vi.fn(),
}));
vi.mock("@/lib/people-merge", () => ({
  mergePersonInto: vi.fn(),
}));
vi.mock("@/lib/workspace", () => ({
  duckdbPathAsync: vi.fn(async () => "/tmp/workspace.duckdb"),
  duckdbExecOnFileAsync: vi.fn(async () => true),
}));
vi.mock("@/lib/crm-queries", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/crm-queries")>();
  return { ...original, loadCrmFieldMaps: vi.fn(async () => ({ people: {} })) };
});

const { POST } = await import("./route");
const { isValidTrackingWriteKey } = await import("@/lib/tracking");
const { findPersonIdByEmail, findPersonIdByAnonymousId, createPersonFromEmail } = await import("@/lib/events");
const { mergePersonInto } = await import("@/lib/people-merge");

const mockedKey = vi.mocked(isValidTrackingWriteKey);
const mockedFindByEmail = vi.mocked(findPersonIdByEmail);
const mockedFindByAnon = vi.mocked(findPersonIdByAnonymousId);
const mockedCreate = vi.mocked(createPersonFromEmail);
const mockedMerge = vi.mocked(mergePersonInto);

function req(body: unknown): Request {
  return new Request("http://localhost/api/events/identify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("/api/events/identify", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedKey.mockReturnValue(true);
  });

  it("rejects an invalid write key with 401", async () => {
    mockedKey.mockReturnValue(false);
    const res = await POST(req({ anonymousId: "a", email: "x@y.z" }));
    expect(res.status).toBe(401);
  });

  it("requires both anonymousId and email", async () => {
    const res = await POST(req({ anonymousId: "a" }));
    expect(res.status).toBe(400);
  });

  it("merges the anonymous shadow into the existing person", async () => {
    mockedFindByEmail.mockResolvedValue("person-1");
    mockedFindByAnon.mockResolvedValue("shadow-1");
    mockedMerge.mockResolvedValue({ ok: true, fieldsCopied: 1, relationsRemapped: 5 });

    const res = await POST(req({ anonymousId: "anon-1", email: "ada@example.com" }));

    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload.personId).toBe("person-1");
    expect(payload.merged).toBe(true);
    expect(payload.createdPerson).toBe(false);
    expect(mockedMerge).toHaveBeenCalledWith({ canonicalId: "person-1", loserId: "shadow-1" });
  });

  it("creates the person when unknown and merges the shadow", async () => {
    mockedFindByEmail.mockResolvedValue(null);
    mockedCreate.mockResolvedValue("person-new");
    mockedFindByAnon.mockResolvedValue("shadow-1");
    mockedMerge.mockResolvedValue({ ok: true, fieldsCopied: 0, relationsRemapped: 2 });

    const res = await POST(req({ anonymousId: "anon-1", email: "new@example.com" }));
    const payload = await res.json();
    expect(payload.createdPerson).toBe(true);
    expect(payload.merged).toBe(true);
    expect(mockedMerge).toHaveBeenCalledWith({ canonicalId: "person-new", loserId: "shadow-1" });
  });

  it("is a no-op merge when the anonymous id is unknown", async () => {
    mockedFindByEmail.mockResolvedValue("person-1");
    mockedFindByAnon.mockResolvedValue(null);

    const res = await POST(req({ anonymousId: "anon-x", email: "ada@example.com" }));
    const payload = await res.json();
    expect(payload.merged).toBe(false);
    expect(mockedMerge).not.toHaveBeenCalled();
  });
});
