import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/campaign-phone", () => ({
  resolvePersonIdByName: vi.fn(async (name: string) => (name === "Lorenzo Lorato" ? "person-1" : null)),
}));
vi.mock("@/lib/phone-webhook", () => ({
  isPhoneWebhookAuthorized: vi.fn(() => true),
  loadPhonePerson: vi.fn(),
}));
vi.mock("@/lib/openclaw-send", () => ({
  deliverToSession: vi.fn(),
}));

const { POST } = await import("./route");
const { isPhoneWebhookAuthorized, loadPhonePerson } = await import("@/lib/phone-webhook");
const { deliverToSession } = await import("@/lib/openclaw-send");
const mockedAuth = vi.mocked(isPhoneWebhookAuthorized);
const mockedLoadPerson = vi.mocked(loadPhonePerson);
const mockedDeliver = vi.mocked(deliverToSession);

function post(body: unknown): Request {
  return new Request("http://localhost/api/campaigns/telegram-person", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const LORENZO = {
  id: "person-1",
  name: "Lorenzo Lorato",
  email: "lorenzo@example.com",
  phone: "+393312345678",
  status: "Active",
  preferredContact: "telegram",
  telegramUserId: "987654321",
  marketingOptIn: "true",
  notes: null,
  lastInteractionAt: null,
  lastOrder: null,
};

describe("POST /api/campaigns/telegram-person", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedAuth.mockReturnValue(true);
  });

  it("401 when not authorized", async () => {
    mockedAuth.mockReturnValue(false);
    const res = await POST(post({ personEntryId: "person-1", body: "ciao" }));
    expect(res.status).toBe(401);
  });

  it("400 when body is missing", async () => {
    const res = await POST(post({ personEntryId: "person-1" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("body is required");
  });

  it("resolves personName and returns 400 when the person is not found", async () => {
    const res = await POST(post({ personName: "Nessuno", body: "ciao" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Person "Nessuno" not found.');
  });

  it("preview returns the target without delivering", async () => {
    mockedLoadPerson.mockResolvedValue(LORENZO as never);
    const res = await POST(post({ personName: "Lorenzo Lorato", body: "ciao", preview: true }));
    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload.preview).toBe(true);
    expect(payload.target).toBe("telegram:987654321");
    expect(payload.person.name).toBe("Lorenzo Lorato");
    expect(mockedDeliver).not.toHaveBeenCalled();
  });

  it("delivers on telegram:<id> when the person has a Telegram User ID", async () => {
    mockedLoadPerson.mockResolvedValue(LORENZO as never);
    mockedDeliver.mockResolvedValue({ ok: true, payload: { messageId: "tg-77" } } as never);
    const res = await POST(post({ personEntryId: "person-1", subject: "Offerta", body: "ciao" }));
    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload.delivered).toBe(true);
    expect(payload.target).toBe("telegram:987654321");
    expect(mockedDeliver).toHaveBeenCalledWith({
      sessionKey: "telegram:987654321",
      message: "Offerta\n\nciao",
    });
  });

  it("falls back to phone:<e164> when no Telegram User ID is on file", async () => {
    mockedLoadPerson.mockResolvedValue({ ...LORENZO, telegramUserId: null } as never);
    mockedDeliver.mockResolvedValue({ ok: true, payload: { messageId: "tg-78" } } as never);
    const res = await POST(post({ personEntryId: "person-1", body: "ciao" }));
    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload.target).toBe("phone:+393312345678");
  });

  it("400 when the person has neither telegram id nor phone", async () => {
    mockedLoadPerson.mockResolvedValue({ ...LORENZO, telegramUserId: null, phone: null } as never);
    const res = await POST(post({ personName: "Lorenzo Lorato", body: "ciao" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("No Telegram user id or phone");
  });

  it("surfaces runtime delivery rejection as 500", async () => {
    mockedLoadPerson.mockResolvedValue(LORENZO as never);
    mockedDeliver.mockResolvedValue({ ok: false, error: "bot offline", payload: null } as never);
    const res = await POST(post({ personEntryId: "person-1", body: "ciao" }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toContain("bot offline");
  });
});