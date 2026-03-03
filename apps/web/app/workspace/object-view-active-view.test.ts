import { describe, expect, it } from "vitest";
import { emptyFilterGroup, type FilterGroup, type SavedView } from "@/lib/object-filters";
import { resolveActiveViewSyncDecision } from "./object-view-active-view";

function statusFilter(value: string): FilterGroup {
  return {
    id: "root",
    conjunction: "and",
    rules: [
      { id: "rule-status", field: "Status", operator: "is", value },
    ],
  };
}

describe("resolveActiveViewSyncDecision", () => {
  const importantView: SavedView = {
    name: "Important",
    filters: statusFilter("Important"),
    columns: ["Name", "Status", "Owner"],
  };

  it("applies active view on initial load even when active view name already matches (prevents visible-but-unapplied bug)", () => {
    const decision = resolveActiveViewSyncDecision({
      savedViews: [importantView],
      activeView: "Important",
      currentActiveViewName: "Important",
      currentFilters: emptyFilterGroup(),
      currentViewColumns: undefined,
    });

    expect(decision).not.toBeNull();
    expect(decision?.shouldApply).toBe(true);
    expect(decision?.nextFilters).toEqual(statusFilter("Important"));
    expect(decision?.nextColumns).toEqual(["Name", "Status", "Owner"]);
  });

  it("does not re-apply when name, filters, and columns are already aligned", () => {
    const decision = resolveActiveViewSyncDecision({
      savedViews: [importantView],
      activeView: "Important",
      currentActiveViewName: "Important",
      currentFilters: statusFilter("Important"),
      currentViewColumns: ["Name", "Status", "Owner"],
    });

    expect(decision).not.toBeNull();
    expect(decision?.shouldApply).toBe(false);
  });

  it("re-applies when active view changes during refresh (keeps label and table state in sync)", () => {
    const backlogView: SavedView = {
      name: "Backlog",
      filters: statusFilter("Backlog"),
      columns: ["Name", "Status"],
    };

    const decision = resolveActiveViewSyncDecision({
      savedViews: [importantView, backlogView],
      activeView: "Backlog",
      currentActiveViewName: "Important",
      currentFilters: statusFilter("Important"),
      currentViewColumns: ["Name", "Status", "Owner"],
    });

    expect(decision).not.toBeNull();
    expect(decision?.shouldApply).toBe(true);
    expect(decision?.nextActiveViewName).toBe("Backlog");
    expect(decision?.nextFilters).toEqual(statusFilter("Backlog"));
    expect(decision?.nextColumns).toEqual(["Name", "Status"]);
  });

  it("returns null when active view is missing or cannot be resolved", () => {
    const missingActive = resolveActiveViewSyncDecision({
      savedViews: [importantView],
      activeView: undefined,
      currentActiveViewName: "Important",
      currentFilters: statusFilter("Important"),
      currentViewColumns: ["Name", "Status", "Owner"],
    });

    const unknownActive = resolveActiveViewSyncDecision({
      savedViews: [importantView],
      activeView: "Unknown",
      currentActiveViewName: "Important",
      currentFilters: statusFilter("Important"),
      currentViewColumns: ["Name", "Status", "Owner"],
    });

    expect(missingActive).toBeNull();
    expect(unknownActive).toBeNull();
  });
});
