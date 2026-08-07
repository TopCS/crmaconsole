import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/workspace", () => ({
  duckdbQueryAsync: vi.fn(),
  duckdbExecOnFileAsync: vi.fn(async () => true),
  duckdbPathAsync: vi.fn(async () => "/tmp/workspace.duckdb"),
}));
vi.mock("@/lib/crm-queries", () => ({
  loadCrmFieldMaps: vi.fn(),
  sqlString: (value: string) => `'${value.replace(/'/g, "''")}'`,
}));

const {
  getAllowedEventTypes,
  EVENT_TYPES,
  createProduct,
  createOrder,
  findProductIdBySku,
  updatePersonFields,
} = await import("./events");
const { duckdbQueryAsync, duckdbExecOnFileAsync } = await import("@/lib/workspace");
const mockedQuery = vi.mocked(duckdbQueryAsync);
const mockedExec = vi.mocked(duckdbExecOnFileAsync);
const { loadCrmFieldMaps } = await import("@/lib/crm-queries");
const mockedFieldMaps = vi.mocked(loadCrmFieldMaps);

describe("getAllowedEventTypes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the module-level cache between cases.
    vi.resetModules();
  });

  it("accepts enum values emitted natively as an array (duckdb -json)", async () => {
    mockedQuery.mockResolvedValue([{ enum_values: ["Email", "Newsletter Signup"] }]);
    const types = await getAllowedEventTypes();
    expect(types).toContain("Newsletter Signup");
  });
});

describe("getAllowedEventTypes (fresh module)", () => {
  it("parses enum values stored as a JSON string, and falls back when missing", async () => {
    vi.resetModules();
    const mod = await import("./events");
    mockedQuery.mockResolvedValue([{ enum_values: '["Email","Video View"]' }]);
    expect(await mod.getAllowedEventTypes()).toContain("Video View");

    vi.resetModules();
    const mod2 = await import("./events");
    mockedQuery.mockResolvedValue([]);
    expect(await mod2.getAllowedEventTypes()).toEqual([...EVENT_TYPES]);
  });
});

describe("commerce helpers (createProduct/createOrder/findProductIdBySku)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedFieldMaps.mockResolvedValue({
      product: {
        Name: "fldp_name",
        Brand: "fldp_brand",
        SKU: "fldp_sku",
        Price: "fldp_price",
        "Available From": "fldp_avail",
        Status: "fldp_status",
      },
      order: {
        Customer: "fldo_customer",
        Product: "fldo_product",
        "Ordered At": "fldo_ordered",
        Amount: "fldo_amount",
        Status: "fldo_status",
        Courier: "fldo_courier",
        "Delivery Status": "fldo_delivery",
        "Tracking URL": "fldo_tracking",
      },
      people: { "Phone Number": "fldp_p_phone", "Full Name": "fldp_p_name", Source: "fldp_p_src" },
    } as never);
  });

  it("createProduct inserts the product entry with its fields", async () => {
    const id = await createProduct({
      name: "Samsung Galaxy S27",
      brand: "Samsung",
      sku: "SAM-S27",
      price: 1199,
      availableFrom: "2026-10-18",
      status: "Upcoming",
    });
    expect(id).toBeTruthy();
    const sql = mockedExec.mock.calls.map((call) => String(call[1])).join("\n");
    expect(sql).toContain("fldp_name");
    expect(sql).toContain("Samsung Galaxy S27");
    expect(sql).toContain("SAM-S27");
    expect(sql).toContain("Upcoming");
  });

  it("findProductIdBySku queries by SKU and returns the entry id", async () => {
    mockedQuery.mockResolvedValue([{ entry_id: "prod-1" }]);
    const id = await findProductIdBySku("SAM-S26");
    expect(id).toBe("prod-1");
    expect(mockedQuery).toHaveBeenCalledWith(expect.stringContaining("SAM-S26"));
  });

  it("createOrder links the order to the person and stores delivery fields", async () => {
    const id = await createOrder({
      personId: "person-1",
      productId: "prod-9",
      orderedAt: "2026-10-12T09:00:00Z",
      amount: 999,
      status: "Shipped",
      courier: "GLS",
      deliveryStatus: "Consegna prevista domani",
    });
    expect(id).toBeTruthy();
    const sql = mockedExec.mock.calls.map((call) => String(call[1])).join("\n");
    expect(sql).toContain("fldo_customer");
    expect(sql).toContain("person-1");
    expect(sql).toContain("fldo_product");
    expect(sql).toContain("prod-9");
    expect(sql).toContain("GLS");
    expect(sql).toContain("Consegna prevista domani");
  });

  it("updatePersonFields skips fields with no mapped id", async () => {
    const ok = await updatePersonFields("person-1", [["Nonexistent", "x"]]);
    expect(ok).toBe(true);
    expect(mockedExec).not.toHaveBeenCalled();
  });
});
