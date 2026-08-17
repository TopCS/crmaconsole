import { beforeEach, describe, expect, it, vi } from "vitest";

const admin = vi.hoisted(() => ({
  ensureProduct: vi.fn(),
  fulfillOrder: vi.fn(),
  getShopInfo: vi.fn(),
  listOrders: vi.fn(),
  listProducts: vi.fn(),
}));

vi.mock("@/lib/shopify-admin", () => admin);
vi.mock("@/lib/phone-webhook", () => ({
  isPhoneWebhookAuthorized: (req: Request) => req.headers.get("authorization") === "Bearer secret",
}));

const { POST } = await import("./route");

function request(body: unknown, authorization = "Bearer secret"): Request {
  return new Request("http://localhost/api/shopify/admin", {
    method: "POST",
    headers: { authorization, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("/api/shopify/admin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    admin.getShopInfo.mockResolvedValue({ name: "Demo Store" });
    admin.listProducts.mockResolvedValue([]);
    admin.listOrders.mockResolvedValue([]);
    admin.ensureProduct.mockResolvedValue({ id: "gid://shopify/Product/1", title: "SAM-S26" });
    admin.fulfillOrder.mockResolvedValue({ fulfillment: { id: 1 } });
  });

  it("rejects requests without the console bearer secret", async () => {
    const response = await POST(request({ action: "store-info" }, "Bearer wrong"));
    expect(response.status).toBe(401);
  });

  it("dispatches safe read actions", async () => {
    const response = await POST(request({ action: "store-info" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, shop: { name: "Demo Store" } });
    expect(admin.getShopInfo).toHaveBeenCalledOnce();
  });

  it("requires confirmation before product creation", async () => {
    const response = await POST(request({ action: "ensure-product", title: "SAM-S26" }));
    expect(response.status).toBe(400);
    expect((await response.json()).needsConfirmation).toBe(true);
    expect(admin.ensureProduct).not.toHaveBeenCalled();
  });

  it("passes confirmed product creation to the Admin client", async () => {
    const response = await POST(request({ action: "ensure-product", title: "SAM-S26", sku: "SAM-S26", confirm: true }));
    expect(response.status).toBe(201);
    expect(admin.ensureProduct).toHaveBeenCalledWith({ title: "SAM-S26", sku: "SAM-S26", price: undefined });
  });

  it("requires confirmation before fulfillment", async () => {
    const response = await POST(request({ action: "fulfill-order", orderId: "123", trackingNumber: "GLS-1" }));
    expect(response.status).toBe(400);
    expect(admin.fulfillOrder).not.toHaveBeenCalled();
  });
});
