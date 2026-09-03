"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { cn } from "@/lib/utils";
import { GraphDetailPanel, type NodeDetail } from "./graph-detail-panel";
import { metaForType, orderedTypeMeta, resolveThemeColors } from "./graph-meta";

const G6Canvas = dynamic(() => import("./g6-canvas").then((m) => m.G6Canvas), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      Loading graph…
    </div>
  ),
});

type GraphNode = { id: string; label: string; type: string };
type GraphEdge = { source: string; target: string; type: string; rel: string };
type GraphData = { nodes: GraphNode[]; edges: GraphEdge[]; truncated: boolean };
type GraphFilter = {
  types: string[];
  labelSearch: string | null;
  focusLabel: string | null;
  depth: number | null;
};

/** Baseline entity types; new types discovered in the data are appended. */
const KNOWN_TYPES = [
  "people",
  "company",
  "task",
  "email_thread",
  "email_message",
  "calendar_event",
  "interaction",
  "segment",
  "campaign",
  "campaign_send",
];

export function GraphView() {
  const [data, setData] = useState<GraphData>({ nodes: [], edges: [], truncated: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [seenTypes, setSeenTypes] = useState<string[]>(KNOWN_TYPES);
  const [types, setTypes] = useState<string[]>([]);
  const [focus, setFocus] = useState<string | null>(null);
  const [depth, setDepth] = useState<number | null>(null);
  const [search, setSearch] = useState<string | null>(null);

  const [nlQuery, setNlQuery] = useState("");
  const [nlBusy, setNlBusy] = useState(false);
  const [nlSource, setNlSource] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<NodeDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const theme = useMemo(() => resolveThemeColors(), []);

  const loadGraph = useCallback(
    async (opts: { types: string[]; focus: string | null; depth: number | null }) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (opts.types.length > 0) {params.set("type", opts.types.join(","));}
        if (opts.focus) {params.set("focus", opts.focus);}
        if (opts.depth != null) {params.set("depth", String(opts.depth));}
        const qs = params.toString();
        const res = await fetch(`/api/crm/graph${qs ? `?${qs}` : ""}`, { cache: "no-store" });
        if (!res.ok) {throw new Error(`graph fetch failed (${res.status})`);}
        const graphData = (await res.json()) as GraphData;
        setData(graphData);
        // Accumulate any entity types we haven't seen yet so they get a chip + legend entry.
        setSeenTypes((prev) => {
          const merged = new Set(prev);
          for (const n of graphData.nodes) {merged.add(n.type);}
          return Array.from(merged);
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load graph");
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    void loadGraph({ types, focus, depth });
  }, [types, focus, depth, loadGraph]);

  const handleNlSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = nlQuery.trim();
    if (!q) {return;}
    setNlBusy(true);
    try {
      const res = await fetch("/api/crm/graph/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q }),
      });
      if (!res.ok) {return;}
      const body = (await res.json()) as { filter?: GraphFilter; source?: string };
      const filter = body.filter;
      if (!filter) {return;}
      setTypes(filter.types ?? []);
      setSearch(filter.labelSearch);
      setDepth(filter.depth ?? null);
      setFocus(filter.focusLabel ?? null);
      setNlSource(body.source ?? null);
    } finally {
      setNlBusy(false);
    }
  };

  const handleNodeClick = useCallback(async (id: string) => {
    setSelectedId(id);
    setDetailLoading(true);
    setDetail(null);
    try {
      const res = await fetch(`/api/crm/graph/node?entryId=${encodeURIComponent(id)}`, { cache: "no-store" });
      if (res.ok) {setDetail((await res.json()) as NodeDetail);}
    } finally {
      setDetailLoading(false);
    }
  }, []);


  const clearFilters = () => {
    setTypes([]);
    setFocus(null);
    setDepth(null);
    setSearch(null);
    setNlQuery("");
    setNlSource(null);
    setSelectedId(null);
    setDetail(null);
  };

  // Client-side label search (substring) on top of the server response.
  const displayed = useMemo<GraphData>(() => {
    const s = search?.trim().toLowerCase();
    if (!s) {return data;}
    const kept = new Set(
      data.nodes.filter((n) => n.label.toLowerCase().includes(s)).map((n) => n.id),
    );
    return {
      nodes: data.nodes.filter((n) => kept.has(n.id)),
      edges: data.edges.filter((e) => kept.has(e.source) && kept.has(e.target)),
      truncated: data.truncated,
    };
  }, [data, search]);

  // When a search narrows the graph to exactly one entity, open its detail
  // panel automatically so its relations are visible at a glance. A ref
  // guards against re-opening after the user explicitly closes the panel.
  const lastAutoOpenedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!search) {return;}
    if (displayed.nodes.length !== 1) {
      lastAutoOpenedRef.current = null;
      return;
    }
    const only = displayed.nodes[0];
    const key = `${search}:${only.id}`;
    if (lastAutoOpenedRef.current === key) {return;}
    lastAutoOpenedRef.current = key;
    void handleNodeClick(only.id);
  }, [displayed, search, handleNodeClick]);

  // A focused NL query ("Lorenzo Lorato") centers the graph on one entity:
  // open its detail panel automatically so its relations are listed.
  const lastFocusOpenedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!focus || displayed.nodes.length === 0) {return;}
    const target = displayed.nodes.find(
      (n) => n.label.toLowerCase() === focus.toLowerCase(),
    );
    if (!target) {return;}
    const key = `${focus}:${target.id}`;
    if (lastFocusOpenedRef.current === key) {return;}
    lastFocusOpenedRef.current = key;
    void handleNodeClick(target.id);
  }, [focus, displayed, handleNodeClick]);

  const legend = useMemo(() => {
    const set = new Set(displayed.nodes.map((n) => n.type));
    return orderedTypeMeta(set);
  }, [displayed.nodes]);

  const toggleType = (value: string) => {
    setTypes((prev) => (prev.includes(value) ? prev.filter((t) => t !== value) : [...prev, value]));
  };

  const hasActiveFilters = types.length > 0 || focus != null || depth != null || search != null;

  return (
    <div className="flex h-full flex-col">
      {/* Header + natural-language query */}
      <div className="border-b border-border px-4 py-3">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Relationship graph</h2>
            <p className="text-xs text-muted-foreground">
              Click a node for details · hover to highlight · drag to pan · scroll to zoom
            </p>
          </div>
          <form onSubmit={handleNlSubmit} className="flex w-full max-w-md items-center gap-2">
            <input
              value={nlQuery}
              onChange={(e) => setNlQuery(e.target.value)}
              placeholder='e.g. "persone collegate ad Acme entro 2 hop"'
              className="h-9 flex-1 rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary"
            />
            <button
              type="submit"
              disabled={nlBusy}
              className="h-9 shrink-0 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {nlBusy ? "…" : "Search"}
            </button>
          </form>
        </div>

        {/* Type filter chips */}
        <div className="flex flex-wrap items-center gap-1.5">
          {seenTypes.map((t) => {
            const meta = metaForType(t);
            const active = types.includes(t);
            return (
              <button
                key={t}
                type="button"
                onClick={() => toggleType(t)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors",
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-input bg-background text-muted-foreground hover:bg-accent",
                )}
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: meta.color }}
                  aria-hidden
                />
                {meta.label}
              </button>
            );
          })}
          {hasActiveFilters ? (
            <button
              type="button"
              onClick={clearFilters}
              className="px-2 py-1 text-xs text-muted-foreground underline hover:text-foreground"
            >
              Clear
            </button>
          ) : null}
        </div>
      </div>

      {/* Canvas + detail panel */}
      <div className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1 overflow-hidden">
          {loading ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Loading graph…
            </div>
          ) : error ? (
            <div className="flex h-full items-center justify-center text-sm text-destructive">{error}</div>
          ) : displayed.nodes.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              No entities match the current filter.
            </div>
          ) : (
            <G6Canvas nodes={displayed.nodes} edges={displayed.edges} theme={theme} onNodeClick={handleNodeClick} />
          )}

          {/* status footer + legend */}
          <div className="pointer-events-none absolute bottom-2 left-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="whitespace-nowrap">
              {displayed.nodes.length} nodes · {displayed.edges.length} edges
            </span>
            {displayed.truncated ? <span className="whitespace-nowrap text-amber-600">(truncated)</span> : null}
            {nlSource ? <span className="whitespace-nowrap text-muted-foreground/70">· {nlSource}</span> : null}
            {legend.length > 0 ? (
              <span className="pointer-events-auto flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
                {legend.map(({ type, meta }) => (
                  <span key={type} className="inline-flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: meta.color }} aria-hidden />
                    {meta.label}
                  </span>
                ))}
              </span>
            ) : null}
          </div>
        </div>

        {selectedId ? (
          <GraphDetailPanel
            detail={detail}
            loading={detailLoading}
            onClose={() => {
              setSelectedId(null);
              setDetail(null);
            }}
            onSelectNode={handleNodeClick}
          />
        ) : null}
      </div>
    </div>
  );
}
