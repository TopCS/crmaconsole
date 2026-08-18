"use client";

import { useEffect, useRef } from "react";
import { Graph, NodeEvent } from "@antv/g6";

export type G6Node = { id: string; label: string; type: string };
export type G6Edge = { source: string; target: string; type: string; rel: string };

type G6CanvasProps = {
  nodes: G6Node[];
  edges: G6Edge[];
  onNodeClick?: (id: string) => void;
};

/**
 * Thin wrapper around a G6 graph instance. G6 is loaded client-only (this
 * component is reached through `next/dynamic` with `ssr:false` in the view)
 * because it needs a real DOM/canvas.
 *
 * Two G6-specific gotchas are handled here:
 *  - G6 reserves the `type` data field for the element SHAPE (circle/line/…),
 *    so our entity/relation type is renamed to `entityType` / `relationType`
 *    before the data is handed over (otherwise G6 logs "element <x> not
 *    registered").
 *  - `Graph.render()` is async and initializes the runtime (`initRuntime`,
 *    which sets `context.transform`) only after `await initCanvas()`. Calling
 *    `render()` twice concurrently on mount races that init and throws
 *    `Cannot read properties of undefined (reading 'getTransformInstance')`.
 *    The graph is therefore created once here (no render) and the data effect
 *    below drives the single first render.
 */
export function G6Canvas({ nodes, edges, onNodeClick }: G6CanvasProps) {
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
      node: {
        style: {
          size: 26,
          labelText: (d: unknown) => (d as { label?: string }).label ?? "",
          labelPlacement: "bottom",
          labelFill: "#475569",
          labelFontSize: 11,
        },
        palette: { field: "entityType", color: "tableau" },
      },
      edge: {
        style: {
          stroke: "#cbd5e1",
          lineWidth: 1,
          endArrow: true,
          labelText: (d: unknown) => (d as { relationType?: string }).relationType ?? "",
          labelFill: "#94a3b8",
          labelFontSize: 9,
        },
      },
      layout: { type: "d3-force", manyBody: {}, x: {}, y: {} },
      behaviors: ["drag-canvas", "zoom-canvas", "drag-element"],
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
