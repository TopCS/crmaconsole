import { describe, expect, it } from "vitest";
import { buildSegmentWhereSql, type SegmentDefinition } from "./segments";
import { emptyFilterGroup, type FilterRule } from "./object-filters";

const IDS = {
  personFieldId: "fld_person",
  typeFieldId: "fld_type",
  occurredFieldId: "fld_occurred",
  interactionObjectId: "obj_interaction",
};

function peopleRule(patch: Partial<FilterRule>): FilterRule {
  return { id: "r1", field: "Job Title", operator: "contains", value: "engineer", ...patch };
}

describe("buildSegmentWhereSql", () => {
  it("returns null for an empty definition", () => {
    expect(buildSegmentWhereSql({}, IDS)).toBeNull();
  });

  it("builds a people-field-only clause via the filter engine", () => {
    const filters = emptyFilterGroup();
    filters.rules = [peopleRule({})];
    const sql = buildSegmentWhereSql({ filters }, IDS);
    expect(sql).toContain("Job Title");
    expect(sql).toContain("engineer");
    expect(sql).not.toContain("COUNT(*)");
  });

  it("builds a 'has' event condition as a COUNT >= min subquery", () => {
    const def: SegmentDefinition = {
      events: [{ type: "Page View", operator: "has", minCount: 3 }],
    };
    const sql = buildSegmentWhereSql(def, IDS)!;
    expect(sql).toContain("COUNT(*)");
    expect(sql).toContain("fld_person");
    expect(sql).toContain("fld_type");
    expect(sql).toContain("Page View");
    expect(sql).toContain(">= 3");
  });

  it("defaults 'has' minCount to 1 and maps 'has_not' to = 0", () => {
    const has = buildSegmentWhereSql(
      { events: [{ type: "Purchase", operator: "has" }] },
      IDS,
    )!;
    expect(has).toContain(">= 1");

    const hasNot = buildSegmentWhereSql(
      { events: [{ type: "Purchase", operator: "has_not" }] },
      IDS,
    )!;
    expect(hasNot).toContain("= 0");
  });

  it("adds an occurred-at cutoff join when withinDays is set", () => {
    const sql = buildSegmentWhereSql(
      { events: [{ type: "Email", operator: "has", withinDays: 7 }] },
      IDS,
    )!;
    expect(sql).toContain("fld_occurred");
    expect(sql).toContain("ot.value >=");
  });

  it("combines people filters and event conditions with AND", () => {
    const filters = emptyFilterGroup();
    filters.rules = [peopleRule({})];
    const sql = buildSegmentWhereSql(
      { filters, events: [{ type: "Page View", operator: "has" }] },
      IDS,
    )!;
    expect(sql).toContain("engineer");
    expect(sql).toContain("COUNT(*)");
    expect(sql).toContain(") AND (");
  });

  it("escapes single quotes in event types", () => {
    const sql = buildSegmentWhereSql(
      { events: [{ type: "it's", operator: "has" }] },
      IDS,
    )!;
    expect(sql).toContain("it''s");
  });
});
