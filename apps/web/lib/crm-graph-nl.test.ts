import { describe, expect, it } from "vitest";
import {
  EMPTY_GRAPH_FILTER,
  heuristicGraphFilter,
  normalizeGraphFilter,
  parseGraphFilterJson,
} from "./crm-graph-nl";

describe("normalizeGraphFilter", () => {
  it("whitelists types, clamps depth, and keeps label/focus strings", () => {
    const f = normalizeGraphFilter({
      types: ["people", "bogus", "company", "people"],
      depth: 99,
      labelSearch: "acme",
      focusLabel: "Acme Corp",
    });
    expect(f.types).toEqual(["people", "company"]);
    expect(f.depth).toBe(3);
    expect(f.labelSearch).toBe("acme");
    expect(f.focusLabel).toBe("Acme Corp");
  });

  it("returns an empty filter for null / non-object input", () => {
    expect(normalizeGraphFilter(null)).toEqual(EMPTY_GRAPH_FILTER);
    expect(normalizeGraphFilter("nope")).toEqual(EMPTY_GRAPH_FILTER);
  });

  it("drops a non-numeric depth", () => {
    expect(normalizeGraphFilter({ depth: "2" }).depth).toBeNull();
  });
});

describe("heuristicGraphFilter", () => {
  it("detects entity-type keywords", () => {
    expect(heuristicGraphFilter("mostrami le persone e le aziende").types).toEqual([
      "people",
      "company",
    ]);
  });

  it("detects hop depth from \"entro 2 hop\"", () => {
    expect(heuristicGraphFilter("persone entro 2 hop").depth).toBe(2);
  });

  it("detects a focus phrase", () => {
    expect(heuristicGraphFilter("persone collegate ad Acme Corp").focusLabel).toBe(
      "Acme Corp",
    );
  });

  it("returns an empty filter for a blank query", () => {
    expect(heuristicGraphFilter("   ")).toEqual(EMPTY_GRAPH_FILTER);
  });
});

describe("parseGraphFilterJson", () => {
  it("parses a fenced JSON reply", () => {
    const f = parseGraphFilterJson('```json\n{"types":["people"],"depth":2}\n```');
    expect(f.types).toEqual(["people"]);
    expect(f.depth).toBe(2);
  });

  it("returns an empty filter on garbage", () => {
    expect(parseGraphFilterJson("not json at all")).toEqual(EMPTY_GRAPH_FILTER);
  });
});
