import {
  type FilterGroup,
  type SavedView,
  emptyFilterGroup,
  serializeFilters,
} from "@/lib/object-filters";

function areColumnsEqual(
  a: string[] | undefined,
  b: string[] | undefined,
): boolean {
  if (!a && !b) {return true;}
  if (!a || !b) {return false;}
  if (a.length !== b.length) {return false;}
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {return false;}
  }
  return true;
}

function areFiltersEqual(a: FilterGroup, b: FilterGroup): boolean {
  return serializeFilters(a) === serializeFilters(b);
}

export type ActiveViewSyncDecision = {
  shouldApply: boolean;
  nextFilters: FilterGroup;
  nextColumns: string[] | undefined;
  nextActiveViewName: string;
};

export function resolveActiveViewSyncDecision(params: {
  savedViews: SavedView[] | undefined;
  activeView: string | undefined;
  currentActiveViewName: string | undefined;
  currentFilters: FilterGroup;
  currentViewColumns: string[] | undefined;
}): ActiveViewSyncDecision | null {
  const activeView = params.activeView;
  if (!activeView) {return null;}

  const view = (params.savedViews ?? []).find((candidate) => candidate.name === activeView);
  if (!view) {return null;}

  const nextFilters = view.filters ?? emptyFilterGroup();
  const nextColumns = view.columns;
  const nextActiveViewName = view.name;

  const nameMismatch = params.currentActiveViewName !== nextActiveViewName;
  const filterMismatch = !areFiltersEqual(params.currentFilters, nextFilters);
  const columnMismatch = !areColumnsEqual(params.currentViewColumns, nextColumns);

  return {
    shouldApply: nameMismatch || filterMismatch || columnMismatch,
    nextFilters,
    nextColumns,
    nextActiveViewName,
  };
}
