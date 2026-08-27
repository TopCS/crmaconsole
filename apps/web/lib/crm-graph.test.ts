import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, copyFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchCrmGraph, fetchGraphNodeDetail, KNOWN_OBJECT_TYPES } from "./crm-graph";

const SEED_DB = fileURLToPath(
  new URL("../../../assets/seed/workspace.duckdb", import.meta.url),
);

/**
 * Integration test for the read-only graph projection. Points the workspace
 * resolver at a throwaway `OPENCLAW_HOME` containing a copy of the committed
 * seed DB, then exercises the real `duckdbQueryAsync` path (duckdb CLI 1.5.5).
 */
describe("crm-graph (integration, against seed)", () => {
  let tempHome = "";

  beforeAll(async () => {
    tempHome = await mkdtemp(join(tmpdir(), "crm-graph-"));
    const workspaceDir = join(tempHome, ".openclaw-crm-a", "workspace");
    await mkdir(workspaceDir, { recursive: true });
    await copyFile(SEED_DB, join(workspaceDir, "workspace.duckdb"));
    process.env.OPENCLAW_HOME = tempHome;
    process.env.OPENCLAW_WORKSPACE = workspaceDir;
  });

  afterAll(async () => {
    delete process.env.OPENCLAW_HOME;
    delete process.env.OPENCLAW_WORKSPACE;
    if (tempHome) {
      await rm(tempHome, { recursive: true, force: true });
    }
  });

  it("exposes the 12 known object types", () => {
    expect(KNOWN_OBJECT_TYPES).toHaveLength(12);
    expect(KNOWN_OBJECT_TYPES).toContain("people");
    expect(KNOWN_OBJECT_TYPES).toContain("campaign_send");
    expect(KNOWN_OBJECT_TYPES).toContain("product");
    expect(KNOWN_OBJECT_TYPES).toContain("order");
  });

  it("returns all seed nodes and edges", async () => {
    const graph = await fetchCrmGraph();
    // 5 people + 3 company + 5 task = 13 nodes; 3 people→company edges.
    expect(graph.nodes).toHaveLength(13);
    expect(graph.edges).toHaveLength(3);
    expect(graph.truncated).toBe(false);
  });

  it("filters nodes by type", async () => {
    const graph = await fetchCrmGraph({ types: ["people"] });
    expect(graph.nodes).toHaveLength(5);
    expect(graph.nodes.every((n) => n.type === "people")).toBe(true);
    // people→company edges are dropped once companies are filtered out.
    expect(graph.edges).toHaveLength(0);
  });

  it("restricts to a focused neighborhood (focus label + depth)", async () => {
    const graph = await fetchCrmGraph({ focus: "Acme Corp", depth: 1 });
    const ids = new Set(graph.nodes.map((n) => n.id));
    expect(ids.has("seed_ent_company_acme_000000000")).toBe(true);
    expect(ids.has("seed_ent_people_sarah_000000000")).toBe(true);
    expect(graph.edges).toHaveLength(1);
  });

  it("resolves a node detail lazily", async () => {
    const detail = await fetchGraphNodeDetail("seed_ent_people_sarah_000000000");
    expect(detail?.type).toBe("people");
    expect(detail?.label).toBe("Sarah Chen");
    expect((detail?.fields ?? []).length).toBeGreaterThan(0);
  });
});
