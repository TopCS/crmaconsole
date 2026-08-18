import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyShopifyFulfillment,
  deliveryTextFromFulfillment,
  mapShopifyOrder,
  verifyShopifyHmac,
} from "./shopify";
import {
  createPersonFromEmail,
  createPersonFromPhone,
  findPersonIdByEmail,
  findPersonIdByPhone,
} from "./events";
import { loadLastOrder, loadPhonePerson } from "./phone-webhook";

vi.mock("@/lib/events", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./events")>();
  return {
    ...actual,
    createPersonFromEmail: vi.fn(),
    createPersonFromPhone: vi.fn(),
    findPersonIdByEmail: vi.fn(),
    findPersonIdByPhone: vi.fn(),
  };
});
vi.mock("@/lib/phone-webhook", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./phone-webhook")>();
  return {
    ...actual,
    loadLastOrder: vi.fn(),
    loadPhonePerson: vi.fn(),
  };
});
vi.mock("@/lib/crm-queries", () => ({ loadCrmFieldMaps: vi.fn() }));
vi.mock("@/lib/workspace", () => ({
  duckdbPathAsync: vi.fn(),
  duckdbQueryAsync: vi.fn(),
  duckdbExecOnFileAsync: vi.fn(),
}));

const ORDER = {
  id: 4507894692,
  order_number: 1001,
  created_at: "2026-10-12T09:00:00Z",
  currency: "EUR",
  total_price: "999.00",
  financial_status: "paid",
  order_status_url: "https://demo-store.myshopify.com/admin/orders/4507894692",
  email: "lorenzo@example.com",
  customer: {
    email: "LORENZO@Example.COM",
    phone: "+39 331 234 5678",
    first_name: "Lorenzo",
    last_name: "Rossi",
  },
  line_items: [
    { sku: "SAM-S26", title: "Samsung Galaxy S26", quantity: 1, price: "999.00" },
    { sku: "", title: "Gift bag", quantity: 2, price: "0.00" },
  ],
  fulfillments: [
    {
      tracking_company: "GLS",
      tracking_number: "DEMO-S26",
      tracking_url: "https://gls.example/track/DEMO-S26",
      status: "in_transit",
    },
  ],
};

describe("mapShopifyOrder", () => {
  it("maps order fields and normalizes identifiers", () => {
    const data = mapShopifyOrder(ORDER);
    expect(data).not.toBeNull();
    expect(data!.shopifyOrderId).toBe("4507894692");
    expect(data!.orderNumber).toBe(1001);
    expect(data!.email).toBe("lorenzo@example.com"); // lowercased
    expect(data!.phone).toBe("+393312345678"); // spaces stripped, + kept
    expect(data!.name).toBe("Lorenzo Rossi");
    expect(data!.totalPrice).toBe(999);
    expect(data!.status).toBe("Paid");
    expect(data!.createdAt).toBe("2026-10-12T09:00:00.000Z");
    expect(data!.orderUrl).toContain("/admin/orders/");
  });

  it("drops line items without a title or sku and keeps sku'd fulfilment", () => {
    const data = mapShopifyOrder(ORDER)!;
    expect(data.lineItems).toHaveLength(2);
    expect(data.lineItems[0].sku).toBe("SAM-S26");
    expect(data.fulfillments).toHaveLength(1);
    expect(data.fulfillments[0].trackingCompany).toBe("GLS");
  });

  it("returns null for a non-order (missing id)", () => {
    expect(mapShopifyOrder({ hello: "world" })).toBeNull();
    expect(mapShopifyOrder(null)).toBeNull();
    expect(mapShopifyOrder("nope")).toBeNull();
  });

  it("maps financial status to CRM buckets", () => {
    expect(mapShopifyOrder({ ...ORDER, financial_status: "paid" })!.status).toBe("Paid");
    expect(mapShopifyOrder({ ...ORDER, financial_status: "voided" })!.status).toBe("Refunded");
    expect(mapShopifyOrder({ ...ORDER, financial_status: "pending" })!.status).toBe("Pending");
  });

  it("falls back to shipping/billing address for phone and maps address fields", () => {
    const body = {
      ...ORDER,
      customer: { email: "lorenzo@example.com", first_name: "Lorenzo", last_name: "Rossi", phone: null },
      shipping_address: {
        first_name: "Lorenzo",
        last_name: "Rossi",
        address1: "Via Benedetto Croce, 44",
        address2: "22",
        city: "Rome",
        zip: "00142",
        province: "Roma",
        country: "Italy",
        phone: "0645210201",
      },
      billing_address: {
        first_name: "Lorenzo",
        last_name: "Rossi",
        address1: "Via Billing",
        city: "Rome",
        zip: "00142",
        province: "Roma",
        country: "Italy",
        phone: "0645219999",
      },
    };
    const data = mapShopifyOrder(body)!;
    expect(data.phone).toBe("0645210201"); // from shipping address
    expect(data.address1).toBe("Via Benedetto Croce, 44");
    expect(data.city).toBe("Rome");
    expect(data.zip).toBe("00142");
    expect(data.province).toBe("Roma");
    expect(data.country).toBe("Italy");
  });

  it("falls back to billing address phone when shipping is missing", () => {
    const body = {
      ...ORDER,
      customer: { email: "lorenzo@example.com", first_name: "Lorenzo", last_name: "Rossi", phone: null },
      billing_address: { phone: "0645210201" },
    };
    const data = mapShopifyOrder(body)!;
    expect(data.phone).toBe("0645210201");
  });
});

describe("deliveryTextFromFulfillment", () => {
  it("maps known statuses and returns null otherwise", () => {
    expect(deliveryTextFromFulfillment("in_transit")).toContain("Corriere in carico");
    expect(deliveryTextFromFulfillment("delivered")).toContain("Consegnato");
    expect(deliveryTextFromFulfillment(null)).toBeNull();
    expect(deliveryTextFromFulfillment("weird")).toBeNull();
  });
});

describe("verifyShopifyHmac", () => {
  const secret = "shpat_demo_secret";
  const body = JSON.stringify(ORDER);
  const valid = createHmac("sha256", secret).update(body, "utf-8").digest("base64");

  it("accepts a correct signature", () => {
    expect(verifyShopifyHmac(body, valid, secret)).toBe(true);
  });

  it("rejects wrong/missing secrets and signatures", () => {
    expect(verifyShopifyHmac(body, createHmac("sha256", "other").update(body).digest("base64"), secret)).toBe(false);
    expect(verifyShopifyHmac(body, null, secret)).toBe(false);
    expect(verifyShopifyHmac("", valid, secret)).toBe(false);
    expect(verifyShopifyHmac(body, "short", secret)).toBe(false);
  });
});

describe("applyShopifyFulfillment (find-only — never creates)", () => {
  beforeEach(() => {
    vi.mocked(findPersonIdByEmail).mockReset();
    vi.mocked(findPersonIdByPhone).mockReset();
    vi.mocked(createPersonFromEmail).mockClear();
    vi.mocked(createPersonFromPhone).mockClear();
    vi.mocked(loadPhonePerson).mockResolvedValue(null);
    vi.mocked(loadLastOrder).mockResolvedValue(null);
  });

  const FULFILLED = {
    id: 4507894692,
    email: "lorenzo@example.com",
    customer: { email: "lorenzo@example.com", phone: "+393312345678", first_name: "Lorenzo" },
    fulfillments: [{ tracking_company: "GLS", tracking_url: "https://gls", status: "in_transit" }],
  };

  it("returns updated:false without creating a person when fulfillment arrives with no known customer", async () => {
    vi.mocked(findPersonIdByEmail).mockResolvedValue(null);
    vi.mocked(findPersonIdByPhone).mockResolvedValue(null);
    const data = mapShopifyOrder(FULFILLED)!;

    const result = await applyShopifyFulfillment(data);

    expect(result).toEqual({ personId: "", updated: false });
    expect(createPersonFromEmail).not.toHaveBeenCalled();
    expect(createPersonFromPhone).not.toHaveBeenCalled();
  });

  it("updates nothing and never creates when the customer exists but has no order", async () => {
    vi.mocked(findPersonIdByEmail).mockResolvedValue("p1");
    const data = mapShopifyOrder(FULFILLED)!;

    const result = await applyShopifyFulfillment(data);

    expect(result).toEqual({ personId: "p1", updated: false });
    expect(createPersonFromEmail).not.toHaveBeenCalled();
    expect(createPersonFromPhone).not.toHaveBeenCalled();
  });
});