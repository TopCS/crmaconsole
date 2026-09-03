"use client";

import { Fragment } from "react";
import { cn } from "@/lib/utils";
import { metaForType } from "./graph-meta";

export type NodeRelation = {
  id: string;
  label: string;
  type: string;
  /** Relation field name (e.g. "Company", "Participants"). */
  edgeType: string;
  /** `out` when this entry owns the relation field, `in` when referenced. */
  direction: "out" | "in";
};

export type NodeDetail = {
  id: string;
  type: string;
  label: string;
  fields: Array<{ name: string; type: string; value: string | null }>;
  /** Direct graph neighbors in both directions (may be absent on old payloads). */
  relations?: NodeRelation[];
};

type GraphDetailPanelProps = {
  detail: NodeDetail | null;
  loading: boolean;
  onClose: () => void;
  /** Navigate the graph to another node (clicked in the relations list). */
  onSelectNode?: (id: string) => void;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_RE = /^https?:\/\//i;
const ID_RE = /^seed_/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;
const LONG_TEXT_LIMIT = 240;

function parseJsonSafe(value: string): unknown | undefined {
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {return undefined;}
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

/** `durationSec` → "Duration Sec", `marketing_opt_in` → "Marketing Opt In". */
function humanizeKey(key: string): string {
  const spaced = key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  const text = spaced.trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function formatScalar(value: string, type?: string): React.ReactNode {
  if (type === "email" || EMAIL_RE.test(value)) {
    return (
      <a href={`mailto:${value}`} className="text-primary hover:underline">
        {value}
      </a>
    );
  }
  if (type === "url" || URL_RE.test(value)) {
    return (
      <a href={value} target="_blank" rel="noreferrer" className="text-primary hover:underline">
        {value}
      </a>
    );
  }
  if (ID_RE.test(value) || fieldIsInternalId(value, type)) {
    return <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">{value}</code>;
  }
  return <span className="break-words">{value}</span>;
}

function fieldIsInternalId(value: string, type?: string): boolean {
  return type === "id" || type === "uuid";
}

function PrettyValue({ value, type }: { value: unknown; type?: string }) {
  if (value == null || value === "") {
    return <span className="italic text-muted-foreground">—</span>;
  }

  if (typeof value === "boolean") {
    return <span>{value ? "Yes" : "No"}</span>;
  }

  if (typeof value === "number") {
    return <span>{value.toLocaleString()}</span>;
  }

  if (typeof value !== "string") {
    return <PrettyStructured value={value} />;
  }

  const parsed = parseJsonSafe(value);
  if (parsed !== undefined && typeof parsed === "object") {
    return <PrettyStructured value={parsed} />;
  }

  if (ISO_DATE_RE.test(value)) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return (
        <span title={value}>
          {date.toLocaleString(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      );
    }
  }

  if (value.length > LONG_TEXT_LIMIT) {
    return (
      <details className="group">
        <summary className="cursor-pointer text-xs text-primary hover:underline">
          Show text ({value.length.toLocaleString()} chars)
        </summary>
        <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-relaxed">{value}</p>
      </details>
    );
  }

  return formatScalar(value, type);
}

/** Recursive renderer for parsed JSON objects/arrays (e.g. interaction payloads). */
function PrettyStructured({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span className="italic text-muted-foreground">empty</span>;
    }
    return (
      <ul className="mt-1 space-y-1 border-l border-border pl-2">
        {value.map((item, index) => (
          <li key={index} className="text-sm">
            <PrettyStructured value={item} depth={depth + 1} />
          </li>
        ))}
      </ul>
    );
  }

  if (value != null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(
      ([, v]) => v != null && v !== "",
    );
    if (entries.length === 0) {
      return <span className="italic text-muted-foreground">empty</span>;
    }
    return (
      <dl className={cn("mt-1 space-y-1.5", depth > 0 && "border-l border-border pl-2")}>
        {entries.map(([key, v]) => (
          <div key={key}>
            <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {humanizeKey(key)}
            </dt>
            <dd className="text-sm">
              <PrettyStructured value={v} depth={depth + 1} />
            </dd>
          </div>
        ))}
      </dl>
    );
  }

  const asString = String(value);
  if (asString.length > LONG_TEXT_LIMIT) {
    return (
      <details className="group">
        <summary className="cursor-pointer text-xs text-primary hover:underline">
          Show text ({asString.length.toLocaleString()} chars)
        </summary>
        <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-relaxed">{asString}</p>
      </details>
    );
  }
  return <span className="break-words">{asString}</span>;
}

type RelationGroup = {
  type: string;
  items: NodeRelation[];
};

function groupRelations(relations: NodeRelation[]): RelationGroup[] {
  const map = new Map<string, NodeRelation[]>();
  for (const rel of relations) {
    const bucket = map.get(rel.type);
    if (bucket) {
      bucket.push(rel);
    } else {
      map.set(rel.type, [rel]);
    }
  }
  return Array.from(map.entries())
    .map(([type, items]) => ({
      type,
      items: items.sort((a, b) => a.label.localeCompare(b.label)),
    }))
    .sort((a, b) => a.type.localeCompare(b.type));
}

export function GraphDetailPanel({
  detail,
  loading,
  onClose,
  onSelectNode,
}: GraphDetailPanelProps) {
  const meta = detail ? metaForType(detail.type) : null;
  const relationGroups = detail?.relations ? groupRelations(detail.relations) : [];

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

          {relationGroups.length > 0 ? (
            <div className="mb-4">
              <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Relations ·{" "}
                {detail.relations?.length ?? 0}
              </div>
              <div className="space-y-2.5">
                {relationGroups.map((group) => {
                  const groupMeta = metaForType(group.type);
                  return (
                    <div key={group.type}>
                      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                        <span aria-hidden>{groupMeta.icon}</span>
                        {groupMeta.label}
                        <span className="text-muted-foreground/60">({group.items.length})</span>
                      </div>
                      <ul className="mt-1 space-y-0.5">
                        {group.items.map((rel) => {
                          const relMeta = metaForType(rel.type);
                          return (
                            <li key={`${rel.direction}:${rel.edgeType}:${rel.id}`}>
                              <button
                                type="button"
                                onClick={() => onSelectNode?.(rel.id)}
                                title={`${rel.direction === "out" ? "This node points to" : "Points to this node"} via “${rel.edgeType}”`}
                                className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-sm transition-colors hover:bg-accent"
                              >
                                <span
                                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                                  style={{ backgroundColor: relMeta.color }}
                                  aria-hidden
                                />
                                <span
                                  className={cn(
                                    "shrink-0 font-mono text-[10px]",
                                    rel.direction === "out" ? "text-primary" : "text-muted-foreground",
                                  )}
                                  aria-hidden
                                >
                                  {rel.direction === "out" ? "→" : "←"}
                                </span>
                                <span className="min-w-0 truncate">{rel.label}</span>
                                <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                                  {rel.edgeType}
                                </span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          <dl className="space-y-2">
            {detail.fields.map((field) => {
              const parsed = field.value != null ? parseJsonSafe(field.value) : undefined;
              const isStructured =
                parsed !== undefined && (typeof parsed === "object" || Array.isArray(parsed));
              // Relation fields hold a raw entry id — render the related
              // node's label (clickable) instead of an opaque id.
              const relatedNode =
                field.type === "relation" && field.value != null
                  ? detail.relations?.find((rel) => rel.id === field.value)
                  : undefined;
              return (
                <div key={field.name} className="text-sm">
                  <dt className="text-xs text-muted-foreground">{humanizeKey(field.name)}</dt>
                  <dd
                    className={cn(
                      "mt-0.5",
                      field.value == null && "italic text-muted-foreground",
                      isStructured && "rounded-md border border-border/60 bg-background/60 p-2",
                    )}
                  >
                    {relatedNode ? (
                      <button
                        type="button"
                        onClick={() => onSelectNode?.(relatedNode.id)}
                        className="inline-flex items-center gap-1.5 text-primary hover:underline"
                      >
                        <span aria-hidden>{metaForType(relatedNode.type).icon}</span>
                        {relatedNode.label}
                      </button>
                    ) : (
                      <PrettyValue value={field.value} type={field.type} />
                    )}
                  </dd>
                </div>
              );
            })}
          </dl>
        </div>
      )}
    </aside>
  );
}
