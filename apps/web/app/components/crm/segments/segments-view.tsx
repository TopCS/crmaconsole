"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  defaultOperatorForFieldType,
  emptyFilterGroup,
  filterId,
  operatorsForFieldType,
  type FilterOperator,
  type FilterRule,
} from "@/lib/object-filters";
import type { SegmentDefinition, SegmentEventCondition } from "@/lib/segments";
import { CrmEmptyState, CrmListShell, CrmLoadingState } from "../crm-list-shell";

/**
 * Segmentation section (CDP): list saved segments, build new ones with
 * demographic (people field) filters + event conditions, preview the live
 * member count, and browse members.
 */

type SegmentRow = {
  entry_id: string;
  Name?: string | null;
  Description?: string | null;
  Filter?: string | null;
  "Member Count"?: string | null;
  "Computed At"?: string | null;
};

type Member = {
  entry_id: string;
  name: string | null;
  email: string | null;
  source: string | null;
  strength_score: string | null;
  last_interaction_at: string | null;
};

const PEOPLE_FIELDS = [
  { name: "Full Name", type: "text" },
  { name: "Email Address", type: "email" },
  { name: "Phone Number", type: "text" },
  { name: "Job Title", type: "text" },
  { name: "LinkedIn URL", type: "url" },
  { name: "Company", type: "relation" },
  { name: "Status", type: "enum" },
  { name: "Source", type: "enum" },
  { name: "Strength Score", type: "number" },
  { name: "Last Interaction At", type: "date" },
] as const;

const EVENT_TYPES = ["Email", "Meeting", "Page View", "Form Submit", "Purchase", "Custom"];

const inputStyle = {
  background: "var(--color-surface)",
  color: "var(--color-text)",
  border: "1px solid var(--color-border)",
} as const;

function newRule(): FilterRule {
  const field = PEOPLE_FIELDS[0];
  return {
    id: filterId(),
    field: field.name,
    operator: defaultOperatorForFieldType(field.type),
    value: "",
  };
}

function newCondition(): SegmentEventCondition {
  return { type: "Page View", operator: "has", withinDays: 30, minCount: 1 };
}

function ruleNeedsValue(operator: FilterOperator): boolean {
  return !["is_empty", "is_not_empty", "is_true", "is_false"].includes(operator);
}

export function SegmentsView({ onOpenPerson }: { onOpenPerson?: (entryId: string) => void }) {
  const [segments, setSegments] = useState<SegmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState<SegmentRow | null>(null);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [membersFor, setMembersFor] = useState<SegmentRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/workspace/objects/segment?limit=100", { cache: "no-store" });
      if (!res.ok) {throw new Error(`HTTP ${res.status}`);}
      const data = (await res.json()) as { entries?: SegmentRow[] };
      setSegments(data.entries ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load segments.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleDelete = async (row: SegmentRow) => {
    try {
      await fetch(
        `/api/workspace/objects/segment/entries/${encodeURIComponent(row.entry_id)}`,
        { method: "DELETE" },
      );
      await load();
    } catch { /* keep list stale */ }
  };

  return (
    <CrmListShell
      title="Segmentation"
      count={loading ? null : segments.length}
      toolbar={
        <button
          type="button"
          onClick={() => { setEditing(null); setBuilderOpen(true); }}
          className="rounded-lg px-4 py-2 text-sm font-medium"
          style={{ background: "var(--color-accent)", color: "#fff" }}
        >
          New segment
        </button>
      }
    >
      <div className="p-6 space-y-4">
        <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
          Clusters of people built from demographics and journey events.
        </p>

      {error && (
        <div className="rounded-xl px-4 py-3 text-sm" style={{ background: "rgba(239,68,68,0.08)", color: "var(--color-error)" }}>
          {error}
        </div>
      )}

      {loading ? (
        <CrmLoadingState />
      ) : segments.length === 0 ? (
        <CrmEmptyState
          title="No segments yet"
          description="Create one to start clustering your people."
        />
      ) : (
        <div className="space-y-2">
          {segments.map((row) => (
            <div
              key={row.entry_id}
              className="flex items-center justify-between rounded-xl px-4 py-3"
              style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)" }}
            >
              <div className="min-w-0">
                <div className="text-sm font-medium truncate" style={{ color: "var(--color-text)" }}>
                  {row.Name ?? "Untitled"}
                </div>
                {row.Description && (
                  <div className="text-xs truncate mt-0.5" style={{ color: "var(--color-text-muted)" }}>
                    {row.Description}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className="text-xs tabular-nums" style={{ color: "var(--color-text-muted)" }}>
                  {row["Member Count"] != null && row["Member Count"] !== ""
                    ? `${row["Member Count"]} members`
                    : "—"}
                </span>
                <button
                  type="button"
                  className="text-xs font-medium"
                  style={{ color: "var(--color-accent)" }}
                  onClick={() => setMembersFor(row)}
                >
                  Members
                </button>
                <button
                  type="button"
                  className="text-xs"
                  style={{ color: "var(--color-text-muted)" }}
                  onClick={() => { setEditing(row); setBuilderOpen(true); }}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="text-xs"
                  style={{ color: "var(--color-error)" }}
                  onClick={() => void handleDelete(row)}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {builderOpen && (
        <SegmentBuilder
          initial={editing}
          onClose={() => { setBuilderOpen(false); setEditing(null); }}
          onSaved={() => { setBuilderOpen(false); setEditing(null); void load(); }}
        />
      )}
      {membersFor && (
        <MembersPanel
          segment={membersFor}
          onClose={() => setMembersFor(null)}
          onOpenPerson={(id) => { setMembersFor(null); onOpenPerson?.(id); }}
        />
      )}
      </div>
    </CrmListShell>
  );
}

/* ─── Segment builder modal ─── */

function SegmentBuilder({
  initial,
  onClose,
  onSaved,
}: {
  initial: SegmentRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(initial?.Name ?? "");
  const [description, setDescription] = useState(initial?.Description ?? "");
  const [rules, setRules] = useState<FilterRule[]>([]);
  const [conditions, setConditions] = useState<SegmentEventCondition[]>([]);
  const [preview, setPreview] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!initial?.Filter) {return;}
    try {
      const def = JSON.parse(initial.Filter) as SegmentDefinition;
      setRules(def.filters?.rules.filter((r): r is FilterRule => "field" in r) ?? []);
      setConditions(def.events ?? []);
    } catch { /* invalid stored filter — start clean */ }
  }, [initial]);

  const definition = useMemo<SegmentDefinition>(() => {
    const group = emptyFilterGroup();
    group.rules = rules;
    return {
      ...(rules.length > 0 ? { filters: group } : {}),
      ...(conditions.length > 0 ? { events: conditions } : {}),
    };
  }, [rules, conditions]);

  const computePreview = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/crm/segments/compute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(definition),
      });
      const data = (await res.json()) as { count?: number; error?: string };
      if (!res.ok) {throw new Error(data.error ?? `HTTP ${res.status}`);}
      setPreview(data.count ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Preview failed.");
    }
  }, [definition]);

  const handleSave = async () => {
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const fields = {
        Name: name.trim(),
        Description: description.trim(),
        Filter: JSON.stringify(definition),
      };
      const res = await fetch(
        initial
          ? `/api/workspace/objects/segment/entries/${encodeURIComponent(initial.entry_id)}`
          : "/api/workspace/objects/segment/entries",
        {
          method: initial ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fields }),
        },
      );
      if (!res.ok) {throw new Error(`HTTP ${res.status}`);}
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  const updateRule = (id: string, patch: Partial<FilterRule>) => {
    setRules((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    setPreview(null);
  };

  const updateCondition = (index: number, patch: Partial<SegmentEventCondition>) => {
    setConditions((prev) => prev.map((c, i) => (i === index ? { ...c, ...patch } : c)));
    setPreview(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center" style={{ background: "rgba(0,0,0,0.5)" }}>
      <div
        className="relative mt-8 mb-8 w-full max-w-2xl rounded-2xl overflow-hidden shadow-2xl flex flex-col"
        style={{ background: "var(--color-bg)", border: "1px solid var(--color-border)", maxHeight: "calc(100vh - 4rem)" }}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: "var(--color-border)" }}>
          <h2 className="text-lg font-semibold" style={{ color: "var(--color-text)" }}>
            {initial ? "Edit segment" : "New segment"}
          </h2>
          <button type="button" onClick={onClose} style={{ color: "var(--color-text-muted)" }}>✕</button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          <div className="grid grid-cols-1 gap-3">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Segment name"
              className="w-full rounded-lg px-3 py-2 text-sm outline-none"
              style={inputStyle}
            />
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Description (optional)"
              className="w-full rounded-lg px-3 py-2 text-sm outline-none"
              style={inputStyle}
            />
          </div>

          {/* Demographic filters */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-medium uppercase tracking-wider" style={{ color: "var(--color-text-muted)" }}>
                Demographics
              </h3>
              <button
                type="button"
                className="text-xs font-medium"
                style={{ color: "var(--color-accent)" }}
                onClick={() => { setRules((prev) => [...prev, newRule()]); setPreview(null); }}
              >
                + Add filter
              </button>
            </div>
            {rules.map((rule) => {
              const fieldMeta = PEOPLE_FIELDS.find((f) => f.name === rule.field) ?? PEOPLE_FIELDS[0];
              const ops = operatorsForFieldType(fieldMeta.type);
              return (
                <div key={rule.id} className="flex items-center gap-2">
                  <select
                    value={rule.field}
                    onChange={(e) => {
                      const next = PEOPLE_FIELDS.find((f) => f.name === e.target.value) ?? PEOPLE_FIELDS[0];
                      updateRule(rule.id, { field: next.name, operator: defaultOperatorForFieldType(next.type) });
                    }}
                    className="rounded-lg px-2 py-1.5 text-xs"
                    style={inputStyle}
                  >
                    {PEOPLE_FIELDS.map((f) => (
                      <option key={f.name} value={f.name}>{f.name}</option>
                    ))}
                  </select>
                  <select
                    value={rule.operator}
                    onChange={(e) => updateRule(rule.id, { operator: e.target.value as FilterOperator })}
                    className="rounded-lg px-2 py-1.5 text-xs"
                    style={inputStyle}
                  >
                    {ops.map((op) => (
                      <option key={op.value} value={op.value}>{op.label}</option>
                    ))}
                  </select>
                  {ruleNeedsValue(rule.operator) && (
                    <input
                      value={typeof rule.value === "string" ? rule.value : String(rule.value ?? "")}
                      onChange={(e) => updateRule(rule.id, { value: e.target.value })}
                      placeholder="Value"
                      className="flex-1 rounded-lg px-2 py-1.5 text-xs outline-none"
                      style={inputStyle}
                    />
                  )}
                  <button
                    type="button"
                    className="text-xs"
                    style={{ color: "var(--color-error)" }}
                    onClick={() => { setRules((prev) => prev.filter((r) => r.id !== rule.id)); setPreview(null); }}
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>

          {/* Event conditions */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-medium uppercase tracking-wider" style={{ color: "var(--color-text-muted)" }}>
                Event conditions
              </h3>
              <button
                type="button"
                className="text-xs font-medium"
                style={{ color: "var(--color-accent)" }}
                onClick={() => { setConditions((prev) => [...prev, newCondition()]); setPreview(null); }}
              >
                + Add condition
              </button>
            </div>
            {conditions.map((condition, index) => (
              <div key={index} className="flex items-center gap-2 flex-wrap">
                <select
                  value={condition.operator}
                  onChange={(e) => updateCondition(index, { operator: e.target.value as "has" | "has_not" })}
                  className="rounded-lg px-2 py-1.5 text-xs"
                  style={inputStyle}
                >
                  <option value="has">Did</option>
                  <option value="has_not">Did not</option>
                </select>
                <select
                  value={condition.type}
                  onChange={(e) => updateCondition(index, { type: e.target.value })}
                  className="rounded-lg px-2 py-1.5 text-xs"
                  style={inputStyle}
                >
                  {EVENT_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
                {condition.operator === "has" && (
                  <>
                    <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>at least</span>
                    <input
                      type="number"
                      min={1}
                      value={condition.minCount ?? 1}
                      onChange={(e) => updateCondition(index, { minCount: Number(e.target.value) || 1 })}
                      className="w-14 rounded-lg px-2 py-1.5 text-xs outline-none"
                      style={inputStyle}
                    />
                    <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>times</span>
                  </>
                )}
                <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>in last</span>
                <input
                  type="number"
                  min={0}
                  value={condition.withinDays ?? 0}
                  onChange={(e) => updateCondition(index, { withinDays: Number(e.target.value) || undefined })}
                  className="w-16 rounded-lg px-2 py-1.5 text-xs outline-none"
                  style={inputStyle}
                />
                <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>days (0 = anytime)</span>
                <button
                  type="button"
                  className="text-xs"
                  style={{ color: "var(--color-error)" }}
                  onClick={() => { setConditions((prev) => prev.filter((_, i) => i !== index)); setPreview(null); }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>

          {error && (
            <div className="rounded-xl px-4 py-3 text-sm" style={{ background: "rgba(239,68,68,0.08)", color: "var(--color-error)" }}>
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between px-6 py-4 border-t" style={{ borderColor: "var(--color-border)" }}>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void computePreview()}
              className="rounded-lg px-3 py-2 text-xs font-medium"
              style={{ border: "1px solid var(--color-border)", color: "var(--color-text)" }}
            >
              Compute preview
            </button>
            {preview != null && (
              <span className="text-xs tabular-nums" style={{ color: "var(--color-text-muted)" }}>
                {preview} matching people
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm"
              style={{ color: "var(--color-text-muted)", border: "1px solid var(--color-border)" }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving}
              className="rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-60"
              style={{ background: "var(--color-accent)", color: "#fff" }}
            >
              {saving ? "Saving…" : "Save segment"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Members panel ─── */

function MembersPanel({
  segment,
  onClose,
  onOpenPerson,
}: {
  segment: SegmentRow;
  onClose: () => void;
  onOpenPerson?: (entryId: string) => void;
}) {
  const [members, setMembers] = useState<Member[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/crm/segments/${encodeURIComponent(segment.entry_id)}/members?limit=200`,
          { cache: "no-store" },
        );
        const data = (await res.json()) as { total?: number; members?: Member[]; error?: string };
        if (!res.ok) {throw new Error(data.error ?? `HTTP ${res.status}`);}
        if (cancelled) {return;}
        setTotal(data.total ?? 0);
        setMembers(data.members ?? []);
      } catch (err) {
        if (!cancelled) {setError(err instanceof Error ? err.message : "Failed to load members.");}
      } finally {
        if (!cancelled) {setLoading(false);}
      }
    })();
    return () => { cancelled = true; };
  }, [segment.entry_id]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center" style={{ background: "rgba(0,0,0,0.5)" }}>
      <div
        className="relative mt-8 mb-8 w-full max-w-2xl rounded-2xl overflow-hidden shadow-2xl flex flex-col"
        style={{ background: "var(--color-bg)", border: "1px solid var(--color-border)", maxHeight: "calc(100vh - 4rem)" }}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: "var(--color-border)" }}>
          <h2 className="text-lg font-semibold" style={{ color: "var(--color-text)" }}>
            {segment.Name ?? "Segment"} {total != null ? `· ${total} members` : ""}
          </h2>
          <button type="button" onClick={onClose} style={{ color: "var(--color-text-muted)" }}>✕</button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>Loading…</p>
          ) : error ? (
            <p className="text-sm" style={{ color: "var(--color-error)" }}>{error}</p>
          ) : members.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>No members match this segment.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr style={{ color: "var(--color-text-muted)" }}>
                  <th className="text-left font-medium pb-2">Name</th>
                  <th className="text-left font-medium pb-2">Email</th>
                  <th className="text-left font-medium pb-2">Source</th>
                  <th className="text-right font-medium pb-2">Strength</th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr
                    key={m.entry_id}
                    className="cursor-pointer"
                    onClick={() => onOpenPerson?.(m.entry_id)}
                  >
                    <td className="py-1.5 pr-2" style={{ color: "var(--color-text)" }}>{m.name ?? "—"}</td>
                    <td className="py-1.5 pr-2" style={{ color: "var(--color-text-muted)" }}>{m.email ?? "—"}</td>
                    <td className="py-1.5 pr-2" style={{ color: "var(--color-text-muted)" }}>{m.source ?? "—"}</td>
                    <td className="py-1.5 text-right tabular-nums" style={{ color: "var(--color-text-muted)" }}>
                      {m.strength_score ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
