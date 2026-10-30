import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "maxxi-agent-"));
process.env.CRM_A_MAXXI_DB_DIR = dir;
process.env.CRM_A_MAXXI_FIXTURE = path.resolve(
  __dirname,
  "../../../../../docs/fixtures/maxxi_demo_seed.json",
);

const { seedMaxxiDemo } = await import("./seed");
const { askMaxxi } = await import("./agent");
const { loadMaxxiFixture } = await import("./fixture");

beforeAll(async () => {
  await seedMaxxiDemo();
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("MAXXI grounded agent (AGT-001/AGT-002)", () => {
  it("answers the renewal+architecture question with exact counts and window", async () => {
    const answer = await askMaxxi(
      "Quali visitatori interessati all'architettura hanno la myMAXXI in scadenza nei prossimi 45 giorni e consenso email?",
    );
    expect(answer.grounded).toBe(true);
    expect(answer.intent).toBe("segment_arch_renewal_45d");
    const expected = loadMaxxiFixture().expected_for_reference_seed;
    const eligible = expected.arch_renewal_45d_email_eligible_person_ids.length;
    const excludedConsent = expected.arch_renewal_45d_excluded_consent_person_ids.length;
    expect(answer.counts?.eligible).toBe(eligible);
    expect(answer.counts?.excludedConsent).toBe(excludedConsent);
    expect(answer.window).toEqual({ from: "2026-10-28", to: "2026-12-12" });
    expect(answer.evidence.map((item) => item.id)).toContain("P-MARIA");
    expect(answer.answer).toContain(`${eligible} persone`);
  });

  it("refuses to invent donor amounts", async () => {
    const answer = await askMaxxi("Quanto hanno donato i sostenitori quest'anno?");
    expect(answer.grounded).toBe(false);
    expect(answer.intent).toBe("donations");
    expect(answer.answer).toMatch(/non ho evidenze sufficienti/i);
    expect(answer.answer).toMatch(/non esistono importi/i);
  });

  it("answers person questions with sources", async () => {
    const answer = await askMaxxi("Chi è Maria Rossi?");
    expect(answer.grounded).toBe(true);
    expect(answer.evidence.some((item) => item.kind === "source")).toBe(true);
  });

  it("says it has no evidence for out-of-scope questions", async () => {
    const answer = await askMaxxi("Qual è il meteo di domani al museo?");
    expect(answer.grounded).toBe(false);
    expect(answer.answer).toMatch(/non ho evidenze sufficienti/i);
  });

  it("always flags itself as the deterministic fallback", async () => {
    const answer = await askMaxxi("Quali fonti abbiamo?");
    expect(answer.fallback).toBe(true);
    expect(answer.grounded).toBe(true);
  });
});
