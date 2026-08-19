"use client";

import { cn } from "@/lib/utils";
import { metaForType } from "./graph-meta";

export type NodeDetail = {
  id: string;
  type: string;
  label: string;
  fields: Array<{ name: string; type: string; value: string | null }>;
};

type GraphDetailPanelProps = {
  detail: NodeDetail | null;
  loading: boolean;
  onClose: () => void;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_RE = /^https?:\/\//i;
const ID_RE = /^seed_/;

function fieldValue(field: { name: string; type: string; value: string | null }) {
  const value = field.value;
  if (value == null || value === "") {return <span className="text-muted-foreground">—</span>;}

  if (field.type === "email" || EMAIL_RE.test(value)) {
    return (
      <a href={`mailto:${value}`} className="text-primary hover:underline">
        {value}
      </a>
    );
  }
  if (field.type === "url" || URL_RE.test(value)) {
    return (
      <a href={value} target="_blank" rel="noreferrer" className="text-primary hover:underline">
        {value}
      </a>
    );
  }
  if (ID_RE.test(value) || field.name === "Gmail Thread ID" || field.name === "Gmail Message ID") {
    return <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">{value}</code>;
  }
  return <span className="break-words">{value}</span>;
}

export function GraphDetailPanel({ detail, loading, onClose }: GraphDetailPanelProps) {
  const meta = detail ? metaForType(detail.type) : null;

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-l border-border bg-muted/30">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold">Entity details</h3>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close details"
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          ✕
        </button>
      </div>

      {loading ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          Loading…
        </div>
      ) : !detail || !meta ? (
        <div className="flex flex-1 items-center justify-center px-4 text-center text-sm text-muted-foreground">
          Select a node to inspect its fields.
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-4 py-3">
          <div className="mb-3 flex items-center gap-2">
            <span
              className="flex h-8 w-8 items-center justify-center rounded-full text-sm"
              style={{ backgroundColor: meta.color, color: "#fff" }}
              aria-hidden
            >
              {meta.icon}
            </span>
            <div className="min-w-0">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">{meta.label}</div>
              <div className="truncate text-base font-semibold">{detail.label}</div>
            </div>
          </div>

          <dl className="space-y-2">
            {detail.fields.map((field) => (
              <div key={field.name} className="text-sm">
                <dt className="text-xs text-muted-foreground">{field.name}</dt>
                <dd className={cn("mt-0.5", field.value == null && "italic text-muted-foreground")}>
                  {fieldValue(field)}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </aside>
  );
}
