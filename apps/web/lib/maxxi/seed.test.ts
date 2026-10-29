import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "maxxi-seed-"));
process.env.CRM_A_MAXXI_DB_DIR = dir;
process.env.CRM_A_MAXXI_FIXTURE = path.resolve(
  __dirname,
  "../../../../../docs/fixtures/maxxi_demo_seed.json",
);

const { seedMaxxiDemo, resolveIdentity } = await import("./seed");
const { createCampaignDraft, getActivityByMonth, getCampaignDetail, getDashboardKpis, getPerson360, evaluateArchRenewal45d, listPeople, listReviewCandidates, listSources } =
  await import("./queries");
const { loadMaxxiFixture } = await import("./fixture");

beforeAll(async () => {
  await seedMaxxiDemo();
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("MAXXI seed — determinism and identity", () => {
  it("produces the reference counts", async () => {
    const fixture = loadMaxxiFixture();
    const expected = fixture.expected_for_reference_seed;
    const kpis = await getDashboardKpis();
    expect(kpis.identifiedPeople).toBeGreaterThanOrEqual(expected.identified_people);
    expect(kpis.totalEvents).toBe(expected.total_events);
  });

  it("exposes a monthly activity series for the dashboard chart", async () => {
    const activity = await getActivityByMonth();
    expect(activity.map((point) => point.month)).toEqual(["2026-08", "2026-09", "2026-10"]);
    expect(activity.reduce((sum, point) => sum + point.visits, 0)).toBe(6);
    expect(activity.reduce((sum, point) => sum + point.events, 0)).toBe(11);
  });

  it("searches visitors by name, email and ID", async () => {
    expect((await listPeople({ search: "elena" })).map((person) => person.id)).toEqual(["P-ELENA"]);
    expect((await listPeople({ search: "maria.rossi@" })).some((person) => person.id === "P-MARIA")).toBe(true);
    expect((await listPeople({ search: "P-GIULIA" })).map((person) => person.id)).toEqual(["P-GIULIA"]);
    expect(await listPeople({ search: "nessuno-xy" })).toEqual([]);
  });

  it("shows review candidates only on the matching profile", async () => {
    const maria = await getPerson360("P-MARIA");
    expect(maria?.reviewCandidates.length).toBe(1);
    const giulia = await getPerson360("P-GIULIA");
    expect(giulia?.reviewCandidates).toEqual([]);
  });

  it("returns the full detail of a dry-run campaign draft", async () => {
    const draft = await createCampaignDraft({
      subject: "Bozza di test",
      body: "Testo completo della bozza, nessun invio.",
      principalId: "test",
    });
    const detail = await getCampaignDetail(draft.campaignId);
    expect(detail?.campaign.subject).toBe("Bozza di test");
    expect(detail?.campaign.deliveryMode).toBe("dry_run");
    expect(detail?.segment.counts.eligible).toBe(2);
    expect(detail?.audit.some((row) => row.action === "campaign_draft_created")).toBe(true);
  });

  it("is idempotent: a second run yields identical counts", async () => {
    const first = await getDashboardKpis();
    const second = await seedMaxxiDemo();
    const after = await getDashboardKpis();
    expect(after).toEqual(first);
    expect(second.counts.events).toBe(first.totalEvents);
  });

  it("links one canonical person from two strong sources (ID-001)", async () => {
    const person = await getPerson360("P-MARIA");
    const sources = person?.identityLinks.map((link) => link.sourceSystem).toSorted();
    expect(sources).toEqual(["mymaxxi_manual", "site_form"]);
    expect(person?.person.email).toBe("maria.rossi@example.invalid");
  });

  it("does not merge the ambiguous namesake and flags it for review (ID-002)", async () => {
    const reviews = await listReviewCandidates();
    const flagged = reviews.find((row) => row.sourceRecordId === "P-MARIA-AMBIG");
    expect(flagged).toBeTruthy();
    expect(flagged?.status).toBe("pending");
    // Both identities remain separate canonical people.
    const maria = await getPerson360("P-MARIA");
    const ambig = await getPerson360("P-MARIA-AMBIG");
    expect(maria?.person.email).not.toBe(ambig?.person.email);
  });

  it("never attributes the anonymous ticket (ID-003)", async () => {
    const { maxxiQuery } = await import("./store");
    const rows = await maxxiQuery<{ person_id: string | null; anonymous_subject_id: string | null }>(
      `SELECT person_id, anonymous_subject_id FROM maxxi_event WHERE source_record_id = 'T-ANON-001';`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].person_id).toBeNull();
    expect(rows[0].anonymous_subject_id).toBe("anon-T-ANON-001");
  });

  it("does not treat a purchase as an attended visit (DATA-002)", async () => {
    const person = await getPerson360("P-MARIA");
    const purchase = person?.timeline.find((event) => event.type === "exhibition_ticket_purchased");
    const visit = person?.timeline.find(
      (event) => event.type === "museum_visit_attended" && event.catalogItemId === "X-CALLE-2026",
    );
    expect(purchase).toBeTruthy();
    expect(visit).toBeUndefined();
  });

  it("registers every source as simulated mock with provenance (UI-001)", async () => {
    const sources = await listSources();
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.every((source) => source.mockOrLive === "mock")).toBe(true);
  });
});

describe("MAXXI segment S_ARCH_RENEWAL_45D", () => {
  it("matches the reference eligible set", async () => {
    const fixture = loadMaxxiFixture();
    const segment = await evaluateArchRenewal45d();
    const eligible = segment.eligible.map((member) => member.personId).toSorted();
    expect(eligible).toEqual([...fixture.expected_for_reference_seed.arch_renewal_45d_email_eligible_person_ids].toSorted());
    expect(segment.windowFrom).toBe("2026-10-28");
    expect(segment.windowTo).toBe("2026-12-12");
  });

  it("excludes withdrawn/unknown consent holders (CON-001/CON-002)", async () => {
    const segment = await evaluateArchRenewal45d();
    const excludedIds = segment.excluded.map((member) => member.personId);
    for (const personId of loadMaxxiFixture().expected_for_reference_seed.arch_renewal_45d_excluded_consent_person_ids) {
      expect(excludedIds).toContain(personId);
    }
    const paolo = segment.excluded.find((member) => member.personId === "P-PAOLO");
    expect(paolo?.segmentReason).toBe("excluded_consent");
    expect(paolo?.reasons.join(" ")).toContain("withdrawn");
  });

  it("is stable across reloads", async () => {
    const first = await evaluateArchRenewal45d();
    const second = await evaluateArchRenewal45d();
    expect(second.counts).toEqual(first.counts);
    expect(second.eligible.map((m) => m.personId)).toEqual(first.eligible.map((m) => m.personId));
  });

  it("explains every exclusion", async () => {
    const segment = await evaluateArchRenewal45d();
    expect(segment.excluded.every((member) => member.reasons.length > 0)).toBe(true);
  });
});

describe("resolveIdentity rules", () => {
  const fixture = loadMaxxiFixture();

  it("auto-links a verified email", () => {
    const decision = resolveIdentity(
      { source_system: "site_form", source_record_id: "X", email: "maria.rossi@example.invalid", verified_email: true, observed_at: "2026-09-01" },
      fixture.people,
      new Map(),
    );
    expect(decision).toEqual({ kind: "link", personId: "P-MARIA", method: "verified_email", confidence: 1 });
  });

  it("never merges on name alone", () => {
    const decision = resolveIdentity(
      { source_system: "site_form", source_record_id: "Y", name: "Maria Rossi", email: "", observed_at: "2026-09-01" },
      fixture.people,
      new Map(),
    );
    expect(decision.kind).toBe("review");
  });
});
