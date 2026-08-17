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
vi.mock("@/lib/shopify-config", () => ({
  readShopifyHmacSecret: vi.fn(),
}));
vi.mock("@/lib/phone-webhook", () => ({
  readPhoneWebhookSecret: vi.fn(),
}));
vi.mock("@/lib/shopify", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/shopify")>();
  return {
    ...original,
    ingestShopifyOrder: vi.fn(),
    applyShopifyFulfillment: vi.fn(),
  };
});

const { POST } = await import("./route");
const { readShopifyHmacSecret } = await import("@/lib/shopify-config");
const { readPhoneWebhookSecret } = await import("@/lib/phone-webhook");
const { ingestShopifyOrder, applyShopifyFulfillment } = await import("@/lib/shopify");

const mockedHmacSecret = vi.mocked(readShopifyHmacSecret);
const mockedPhoneSecret = vi.mocked(readPhoneWebhookSecret);
const mockedIngest = vi.mocked(ingestShopifyOrder);
const mockedApply = vi.mocked(applyShopifyFulfillment);

const ORDER = {
  id: 4507894692,
  email: "lorenzo@example.com",
  customer: { email: "lorenzo@example.com", phone: "+393312345678", first_name: "Lorenzo" },
  total_price: "999.00",
  financial_status: "paid",
  line_items: [{ sku: "SAM-S26", title: "Samsung Galaxy S26", quantity: 1, price: "999.00" }],
};

function post(body: string, topic: string, extra?: { [k: string]: string }) {
  return new Request("http://localhost/api/webhooks/shopify?token=demo-secret", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Topic": topic, ...extra },
    body,
  });
}

describe("POST /api/webhooks/shopify", () => {
  beforeEach(() => {
    mockedHmacSecret.mockReturnValue(undefined); // token path
    mockedPhoneSecret.mockReturnValue("demo-secret");
    mockedIngest.mockResolvedValue({
      personId: "p1",
      matched: "created",
      createdPerson: true,
      eventId: "e1",
      orderId: "o1",
      duplicate: false,
      productId: "prod1",
    });
    mockedApply.mockResolvedValue({ personId: "p1", updated: true });
    mockedIngest.mockClear();
    mockedApply.mockClear();
  });

  it("rejects when no token and no HMAC secret", async () => {
    mockedPhoneSecret.mockReturnValue(undefined);
    const res = await POST(post(JSON.stringify(ORDER), "orders/create"));
    expect(res.status).toBe(401);
  });

  it("ingests orders/create with a valid token", async () => {
    const res = await POST(post(JSON.stringify(ORDER), "orders/create"));
    expect(res.status).toBe(201);
    expect(mockedIngest).toHaveBeenCalledTimes(1);
    const data = (await res.json()) as { ok: boolean; matched: string };
    expect(data.ok).toBe(true);
    expect(data.matched).toBe("created");
  });

  it("routes order/fulfilled to fulfillment handling", async () => {
    const res = await POST(post(JSON.stringify(ORDER), "order/fulfilled"));
    expect(res.status).toBe(200);
    expect(mockedApply).toHaveBeenCalledTimes(1);
    const data = (await res.json()) as { updated: boolean };
    expect(data.updated).toBe(true);
  });

  it("rejects unsupported topics", async () => {
    const res = await POST(post(JSON.stringify(ORDER), "customer/data_request"));
    expect(res.status).toBe(400);
    expect(mockedIngest).not.toHaveBeenCalled();
  });

  it("rejects invalid JSON", async () => {
    const res = await POST(post("{ nope", "orders/create"));
    expect(res.status).toBe(400);
  });

  it("rejects a non-order payload", async () => {
    const res = await POST(post(JSON.stringify({ hello: "world" }), "orders/create"));
    expect(res.status).toBe(400);
  });
});