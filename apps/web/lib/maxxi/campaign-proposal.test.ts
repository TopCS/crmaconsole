import { describe, expect, it } from "vitest";
import { generateCampaignProposal, type CatalogOption } from "./campaign-proposal";
import type { SegmentResult } from "./queries";

const segment: SegmentResult = {
  segmentId: "S_ARCH_RENEWAL_45D",
  segmentName: "Architettura + rinnovo myMAXXI entro 45 giorni",
  windowFrom: "2026-10-28",
  windowTo: "2026-12-12",
  eligible: [],
  excluded: [],
  counts: { eligible: 2, excludedConsent: 2, excludedIdentity: 2, excludedMissingData: 2 },
};

const catalog: CatalogOption[] = [
  {
    id: "X-ARCH-2026",
    title: "Vitalità dell'architettura italiana 1946-2026",
    startDate: "2026-05-29",
    endDate: "2026-11-15",
    isPublicReal: true,
  },
];

describe("campaign proposal", () => {
  it("uses a deterministic verified template without a provider", async () => {
    const result = await generateCampaignProposal({ segment, catalog, apiKey: null });
    expect(result.mode).toBe("template");
    expect(result.subject).toContain("Vitalità dell'architettura");
    expect(result.body).toContain("2 persone");
    expect(result.sources).toEqual(["X-ARCH-2026"]);
  });

  it("parses a validated LLM JSON response", async () => {
    const result = await generateCampaignProposal({
      segment,
      catalog,
      apiKey: "test-key",
      model: "test/model",
      fetchImpl: async () =>
        Response.json({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  subject: "Rinnova myMAXXI",
                  body: "Segui la mostra e rinnova la card. Nessun invio.",
                }),
              },
            },
          ],
        }),
    });
    expect(result.mode).toBe("llm");
    expect(result.subject).toBe("Rinnova myMAXXI");
    expect(result.model).toBe("test/model");
  });

  it("falls back when the provider returns invalid content or an error", async () => {
    const invalid = await generateCampaignProposal({
      segment,
      catalog,
      apiKey: "test-key",
      fetchImpl: async () => Response.json({ choices: [{ message: { content: "not json" } }] }),
    });
    expect(invalid.mode).toBe("template");
    expect(invalid.fallbackReason).toBe("provider_invalid_json");

    const http = await generateCampaignProposal({
      segment,
      catalog,
      apiKey: "test-key",
      fetchImpl: async () => new Response("boom", { status: 500 }),
    });
    expect(http.mode).toBe("template");
    expect(http.fallbackReason).toBe("provider_http_500");
  });
});
