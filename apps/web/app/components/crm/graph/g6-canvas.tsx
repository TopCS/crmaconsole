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
      data: { nodes, edges },
      node: {
        style: {
          size: 26,
          labelText: (d: unknown) => (d as G6Node).label ?? "",
          labelPlacement: "bottom",
          labelFill: "#475569",
          labelFontSize: 11,
        },
        palette: { field: "type", color: "tableau" },
      },
      edge: {
        style: {
          stroke: "#cbd5e1",
          lineWidth: 1,
          endArrow: true,
          labelText: (d: unknown) => (d as G6Edge).type ?? "",
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

    void graph.render();
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
    graph.setData({ nodes, edges });
    void graph.render();
  }, [nodes, edges]);

  return <div ref={containerRef} className="h-full w-full" />;
}
