import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tracking", () => ({
  isValidTrackingWriteKey: vi.fn(),
}));
vi.mock("@/lib/events", () => ({
  EVENT_TYPES: ["Email", "Meeting", "Page View", "Form Submit", "Purchase", "Custom"],
  isValidEventType: (t: string) =>
    ["Email", "Meeting", "Page View", "Form Submit", "Purchase", "Custom"].includes(t),
  normalizeEmail: (v: unknown) => (typeof v === "string" ? v.trim().toLowerCase() : ""),
  findPersonIdByEmail: vi.fn(),
  findPersonIdByAnonymousId: vi.fn(),
  createPersonFromEmail: vi.fn(),
  resolveShadowPersonId: vi.fn(),
  recordEvent: vi.fn(),
}));

const { POST } = await import("./route");
const { isValidTrackingWriteKey } = await import("@/lib/tracking");
const {
  findPersonIdByEmail,
  findPersonIdByAnonymousId,
  createPersonFromEmail,
  resolveShadowPersonId,
  recordEvent,
} = await import("@/lib/events");

const mockedKey = vi.mocked(isValidTrackingWriteKey);
const mockedFindByEmail = vi.mocked(findPersonIdByEmail);
const mockedFindByAnon = vi.mocked(findPersonIdByAnonymousId);
const mockedCreate = vi.mocked(createPersonFromEmail);
const mockedShadow = vi.mocked(resolveShadowPersonId);
const mockedRecord = vi.mocked(recordEvent);

function req(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/events/collect", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("/api/events/collect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedKey.mockReturnValue(true);
    mockedRecord.mockResolvedValue({ eventId: "evt-1" });
  });

  it("rejects an invalid write key with 401", async () => {
    mockedKey.mockReturnValue(false);
    const res = await POST(req({ type: "Page View", anonymousId: "x" }));
    expect(res.status).toBe(401);
  });

  it("tracks an anonymous pageview against a shadow person", async () => {
    mockedFindByAnon.mockResolvedValue(null);
    mockedShadow.mockResolvedValue("shadow-1");

    const res = await POST(
      req({ type: "Page View", anonymousId: "anon-1", properties: { url: "/pricing" } }),
    );

    expect(res.status).toBe(201);
    const payload = await res.json();
    expect(payload.personId).toBe("shadow-1");
    expect(payload.createdPerson).toBe(true);
    expect(mockedShadow).toHaveBeenCalledWith("anon-1");
    expect(mockedRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        personId: "shadow-1",
        type: "Page View",
        propertiesJson: JSON.stringify({ url: "/pricing" }),
      }),
    );
  });

  it("reuses an existing shadow for a known anonymous id", async () => {
    mockedFindByAnon.mockResolvedValue("shadow-1");
    const res = await POST(req({ type: "Page View", anonymousId: "anon-1" }));
    const payload = await res.json();
    expect(payload.createdPerson).toBe(false);
    expect(mockedShadow).not.toHaveBeenCalled();
  });

  it("resolves the real person when email is present (identity wins)", async () => {
    mockedFindByEmail.mockResolvedValue("person-9");
    const res = await POST(req({ type: "Purchase", anonymousId: "anon-1", email: "ada@example.com" }));
    const payload = await res.json();
    expect(payload.personId).toBe("person-9");
    expect(mockedShadow).not.toHaveBeenCalled();
  });

  it("creates the real person for an unknown email", async () => {
    mockedFindByEmail.mockResolvedValue(null);
    mockedCreate.mockResolvedValue("person-new");
    const res = await POST(req({ type: "Form Submit", email: "new@example.com" }));
    const payload = await res.json();
    expect(payload.createdPerson).toBe(true);
    expect(mockedCreate).toHaveBeenCalledWith("new@example.com");
  });

  it("rejects unknown event types", async () => {
    const res = await POST(req({ type: "Scroll", anonymousId: "x" }));
    expect(res.status).toBe(400);
  });
});
