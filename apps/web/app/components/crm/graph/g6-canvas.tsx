"use client";

import { useEffect, useRef } from "react";
import { Graph, NodeEvent } from "@antv/g6";
import { metaForType, truncateLabel, type GraphTheme } from "./graph-meta";

export type G6Node = { id: string; label: string; type: string };
export type G6Edge = { source: string; target: string; type: string; rel: string };

type G6CanvasProps = {
  nodes: G6Node[];
  edges: G6Edge[];
  theme: GraphTheme;
  onNodeClick?: (id: string) => void;
};

/**
 * Thin wrapper around a G6 graph instance. G6 is loaded client-only (this
 * component is reached through `next/dynamic` with `ssr:false` in the view)
 * because it needs a real DOM/canvas.
 *
 * Load-bearing details (do not restructure):
 *  - G6 reserves the `type` data field for the element SHAPE, so the entity
 *    type is renamed to `entityType` / `relationType` before handing data over.
 *  - `Graph.render()` is async and initializes the runtime only after
 *    `await initCanvas()`, so the graph is created once (no render) and the
 *    data effect drives the first render — two concurrent renders race the
 *    init and throw `getTransformInstance`.
 */
export function G6Canvas({ nodes, edges, theme, onNodeClick }: G6CanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const graphRef = useRef<Graph | null>(null);
  const clickRef = useRef(onNodeClick);
  clickRef.current = onNodeClick;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {return;}

    const graph = new Graph({
      container,
      autoFit: "view",
      padding: 24,
      node: {
        style: {
          size: 34,
          fill: (d: unknown) => metaForType((d as { entityType?: string }).entityType).color,
          stroke: theme.background,
          lineWidth: 2,
          iconText: (d: unknown) => metaForType((d as { entityType?: string }).entityType).icon,
          iconFill: "#ffffff",
          iconFontSize: 14,
          labelText: (d: unknown) => truncateLabel((d as { label?: string }).label ?? ""),
          labelPlacement: "bottom",
          labelFill: theme.foreground,
          labelFontSize: 11,
          labelFontWeight: 500,
          labelBackground: true,
          labelBackgroundFill: theme.background,
          labelBackgroundRadius: 4,
          labelBackgroundPadding: [2, 4] as [number, number],
        },
        state: {
          selected: { lineWidth: 3, stroke: theme.foreground, halo: true, haloLineWidth: 0 },
          active: { lineWidth: 2, stroke: theme.foreground },
          inactive: { opacity: 0.18 },
        },
      },
      edge: {
        style: {
          stroke: theme.border,
          lineWidth: 1.5,
          endArrow: true,
          labelText: (d: unknown) => (d as { relationType?: string }).relationType ?? "",
          labelFill: theme.muted,
          labelFontSize: 9,
          labelBackground: true,
          labelBackgroundFill: theme.background,
          labelBackgroundRadius: 2,
          labelBackgroundPadding: [1, 2] as [number, number],
        },
        state: {
          active: { stroke: theme.foreground, lineWidth: 2 },
          inactive: { opacity: 0.08 },
        },
      },
      layout: {
        type: "d3-force",
        collide: { radius: 40 },
        link: { distance: 120 },
        manyBody: { strength: -220 },
      },
      behaviors: ["drag-canvas", "zoom-canvas", "drag-element", "click-select", "hover-activate"],
      plugins: [
        {
          type: "tooltip",
          getContent: (_event: unknown, items: unknown[]) => {
            const d = items?.[0] as Record<string, unknown> | undefined;
            if (!d) {return "";}
            if (typeof d.entityType === "string" && typeof d.label === "string") {
              return `${metaForType(d.entityType).label} · ${d.label}`;
            }
            if (typeof d.relationType === "string") {return d.relationType;}
            return "";
          },
        },
      ],
    });

    graph.on(NodeEvent.CLICK, (event: unknown) => {
      const id = (event as { target?: { id?: string } }).target?.id;
      if (typeof id === "string") {clickRef.current?.(id);}
    });

    graphRef.current = graph;

    return () => {
      graph.destroy();
      graphRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) {return;}

    graph.setData({
      nodes: nodes.map((n) => ({ id: n.id, label: n.label, entityType: n.type })),
      edges: edges.map((e) => ({ source: e.source, target: e.target, relationType: e.type })),
    });
    graph.render().catch((err: unknown) => {
      console.error("[crm-graph] G6 render failed:", err);
    });
  }, [nodes, edges]);

  return <div ref={containerRef} className="absolute inset-0" />;
}
