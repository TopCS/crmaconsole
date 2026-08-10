import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/phone-webhook", () => ({
  lookupPersonIdByPhone: vi.fn(),
  loadPhonePerson: vi.fn(),
  loadLastOrder: vi.fn(),
  buildPhoneContext: vi.fn(() => "Cliente esistente: Lorenzo."),
  readPhoneWebhookSecret: vi.fn(() => "sec"),
}));

const { GET } = await import("./route");
const { lookupPersonIdByPhone, loadPhonePerson, loadLastOrder, buildPhoneContext } = await import("@/lib/phone-webhook");
const mockedFind = vi.mocked(lookupPersonIdByPhone);
const mockedLoadPerson = vi.mocked(loadPhonePerson);
const mockedLastOrder = vi.mocked(loadLastOrder);
const mockedContext = vi.mocked(buildPhoneContext);

function get(url: string): Request {
  return new Request(url, { method: "GET" });
}

describe("GET /api/nlpearl/precall", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("401 without token", async () => {
    expect((await GET(get("http://localhost/api/nlpearl/precall?phone=%2B39"))).status).toBe(401);
  });

  it("400 without phone", async () => {
    expect((await GET(get("http://localhost/api/nlpearl/precall?token=sec"))).status).toBe(400);
  });

  it("known caller → 200 with context and last order", async () => {
    mockedFind.mockResolvedValue("p1");
    mockedLoadPerson.mockResolvedValue({
      id: "p1", name: "Lorenzo", email: "l@x.it", phone: "+393312345678", status: "Active",
      preferredContact: "phone", marketingOptIn: "true", notes: null, lastInteractionAt: null, lastOrder: null,
    } as never);
    mockedLastOrder.mockResolvedValue({
      id: "o1", productName: "Samsung Galaxy S26", orderedAt: "2026-10-12", status: "Shipped",
      courier: "GLS", deliveryStatus: "Consegna domani entro le 18",
    });

    const res = await GET(get("http://localhost/api/nlpearl/precall?token=sec&phone=%2B393312345678"));
    expect(res.status).toBe(200);
    const data = (await res.json()) as { data: { firstName: string | null } };
    expect(data.data.firstName).toBe("Lorenzo");
    expect(mockedContext).toHaveBeenCalled();
    expect(mockedLastOrder).toHaveBeenCalledWith("p1");
  });

  it("unknown caller → 404 (apiResult:2 branch, no phantom person)", async () => {
    mockedFind.mockResolvedValue(null);
    const res = await GET(get("http://localhost/api/nlpearl/precall?token=sec&phone=%2B39"));
    expect(res.status).toBe(404);
    expect(mockedLoadPerson).not.toHaveBeenCalled();
  });
});