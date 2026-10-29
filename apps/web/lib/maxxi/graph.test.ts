import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "maxxi-graph-"));
process.env.CRM_A_MAXXI_DB_DIR = dir;
process.env.CRM_A_MAXXI_FIXTURE = path.resolve(
  __dirname,
  "../../../../../docs/fixtures/maxxi_demo_seed.json",
);

const { seedMaxxiDemo } = await import("./seed");
const { buildMaxxiGraph, filterMaxxiGraph, getMaxxiGraphNodeDetail } = await import("./graph");

beforeAll(async () => {
  await seedMaxxiDemo();
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("MAXXI graph projection", () => {
  it("builds the demo nodes and relation edges", async () => {
    const graph = await buildMaxxiGraph();
    const ids = new Set(graph.nodes.map((node) => node.id));
    expect(ids.has("P-MARIA")).toBe(true);
    expect(ids.has("P-MARIA-AMBIG")).toBe(true);
    expect(ids.has("O-PARTNER")).toBe(true);
    expect(ids.has("X-ARCH-2026")).toBe(true);
    expect(ids.has("interest:architecture")).toBe(true);
    expect(ids.has("source:site_form")).toBe(true);

    const hasEdge = (source: string, target: string, rel: string) =>
      graph.edges.some((edge) => edge.source === source && edge.target === target && edge.rel === rel);
    expect(hasEdge("P-MARIA", "source:site_form", "identity")).toBe(true);
    expect(hasEdge("P-MARIA", "interest:architecture", "interest")).toBe(true);
    expect(hasEdge("P-MARIA", "X-ARCH-2026", "event")).toBe(true);
    expect(hasEdge("P-MARIA", "X-CALLE-2026", "event")).toBe(true);
    expect(hasEdge("P-GIOVANNI", "O-PARTNER", "relationship")).toBe(true);
    expect(hasEdge("P-MARIA", "P-MARIA-AMBIG", "duplicate")).toBe(true);
  });

  it("restricts to a focus neighborhood", async () => {
    const graph = await buildMaxxiGraph();
    const focused = filterMaxxiGraph(graph, { focus: "P-MARIA", depth: 1 });
    const ids = new Set(focused.nodes.map((node) => node.id));
    expect(ids.has("P-MARIA")).toBe(true);
    expect(ids.has("X-ARCH-2026")).toBe(true);
    expect(ids.has("source:site_form")).toBe(true);
    expect(ids.has("P-SARA")).toBe(false);
  });

  it("filters by node type while keeping the focus and direct neighbors", async () => {
    const graph = await buildMaxxiGraph();
    const focused = filterMaxxiGraph(graph, { focus: "P-MARIA", depth: 2, types: ["person"] });
    expect(focused.nodes.every((node) => node.type === "person")).toBe(false);
    expect(focused.nodes.some((node) => node.id === "P-MARIA")).toBe(true);
    expect(focused.edges.length).toBeGreaterThan(0);
  });

  it("never exposes infopoint notes in person detail", async () => {
    const detail = await getMaxxiGraphNodeDetail("P-GIULIA");
    expect(detail?.type).toBe("person");
    const text = JSON.stringify(detail);
    expect(text).toContain("Giulia Bianchi");
    expect(text).not.toContain("Richiesta informazioni");
    expect(detail?.relations.some((relation) => relation.edgeType === "Possibile duplicato")).toBe(false);
  });

  it("returns source and organization details", async () => {
    const source = await getMaxxiGraphNodeDetail("source:site_form");
    expect(source?.fields.find((field) => field.name === "Modalità")?.value).toBe("mock");
    const org = await getMaxxiGraphNodeDetail("O-PARTNER");
    expect(org?.label).toContain("Laboratorio Fittizio");
    expect(org?.fields.find((field) => field.name === "Persone collegate")?.value).toBe("1");
  });

  it("returns null for an unknown node", async () => {
    expect(await getMaxxiGraphNodeDetail("P-NOPE")).toBeNull();
  });
});
