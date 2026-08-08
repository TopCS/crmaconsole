import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/workspace", () => ({
  duckdbQueryAsync: vi.fn(),
}));
vi.mock("@/lib/crm-queries", () => ({
  loadCrmFieldMaps: vi.fn(),
  sqlString: (v: string) => `'${v.replace(/'/g, "''")}'`,
}));

const { buildMarketingBrief } = await import("./marketing-brief");
const { duckdbQueryAsync } = await import("@/lib/workspace");
const { loadCrmFieldMaps } = await import("@/lib/crm-queries");
const mockedQuery = vi.mocked(duckdbQueryAsync);
const mockedFieldMaps = vi.mocked(loadCrmFieldMaps);

describe("buildMarketingBrief", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedFieldMaps.mockResolvedValue({
      product: {
        Name: "fl_name",
        Brand: "fl_brand",
        SKU: "fl_sku",
        Price: "fl_price",
        "Available From": "fl_avail",
        Status: "fl_status",
        "Marketing Message": "fl_marketing",
      },
      people: {
        "Marketing Opt-in": "fl_optin",
        "Preferred Contact Channel": "fl_pref",
      },
    } as never);
  });

  it("assembles a coherent brief: launch facts, marketing copy, comparison, audience", async () => {
    mockedQuery
      .mockResolvedValueOnce([
        {
          entry_id: "p27",
          name: "Samsung Galaxy S27",
          brand: "Samsung",
          sku: "SAM-S27",
          price: "1199",
          availableFrom: "2026-10-18",
          status: "Upcoming",
          marketingMessage: "Il nuovo flagship. Caratteristiche: ... Differenze rispetto a S26: ...",
        },
        {
          entry_id: "p26",
          name: "Samsung Galaxy S26",
          brand: "Samsung",
          sku: "SAM-S26",
          price: "999",
          availableFrom: null,
          status: "Available",
          marketingMessage: null,
        },
      ]) // loadProducts
      .mockResolvedValueOnce([
        { optin: "true", pref: "telegram" },
        { optin: "true", pref: "email" },
        { optin: "false", pref: null },
      ]); // loadAudienceStats

    const brief = await buildMarketingBrief();

    expect(brief).toContain("# Brief di lancio — Samsung Galaxy S27");
    expect(brief).toContain("**Disponibile dal**: 2026-10-18");
    expect(brief).toContain("**Prezzo**: € 1199");
    expect(brief).toContain("Messaggio di marketing");
    expect(brief).toContain("Il nuovo flagship");
    // comparison picks the non-Upcoming product (S26)
    expect(brief).toContain("**Precedente**: Samsung Galaxy S26 (€ 999)");
    // audience stats
    expect(brief).toContain("**Con opt-in marketing**: 2");
    expect(brief).toContain("**Preferenza Telegram**: 1");
    expect(brief).toContain("**Preferenza email**: 1");
  });

  it("defaults to the Upcoming product and handles an empty catalog", async () => {
    mockedQuery
      .mockResolvedValueOnce([]) // no products
      .mockResolvedValueOnce([]); // no people

    const brief = await buildMarketingBrief();
    expect(brief).toContain("Nessun modello precedente");
    expect(brief).toContain("**Contatti totali**: 0");
  });
});
