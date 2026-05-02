"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import type { OnboardingState } from "@/lib/denchclaw-state";
import {
  SKILL_TEMPLATES,
  getSkillTemplate,
  isSkillTemplateId,
  type SkillTemplate,
  type SkillTemplateCategory,
  type SkillTemplateId,
} from "@/lib/skill-templates";

function initialTemplateId(state: OnboardingState): SkillTemplateId {
  const persisted = state.skillTemplate?.templateId;
  return isSkillTemplateId(persisted) ? persisted : SKILL_TEMPLATES[0].id;
}

const CATEGORY_ORDER: readonly SkillTemplateCategory[] = [
  "Find leads",
  "Research",
  "Follow up",
  "Meetings",
  "CRM hygiene",
];

function templateMatches(template: SkillTemplate, query: string): boolean {
  if (!query.trim()) {
    return true;
  }
  const normalized = query.trim().toLowerCase();
  return [
    template.title,
    template.summary,
    template.category,
    template.outcome,
    template.autonomy,
    ...template.triggerModes,
  ]
    .join(" ")
    .toLowerCase()
    .includes(normalized);
}

export function SkillTemplateStep({
  state,
  onAdvance,
}: {
  state: OnboardingState;
  onAdvance: (next: OnboardingState) => void;
}) {
  const [selectedId, setSelectedId] = useState<SkillTemplateId>(() =>
    initialTemplateId(state),
  );
  const [query, setQuery] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedTemplate = getSkillTemplate(selectedId);
  const groupedTemplates = useMemo(() => {
    return CATEGORY_ORDER.map((category) => ({
      category,
      templates: SKILL_TEMPLATES.filter(
        (template) =>
          template.category === category && templateMatches(template, query),
      ),
    })).filter((group) => group.templates.length > 0);
  }, [query]);

  const handleContinue = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/onboarding/state", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "skill-template",
          to: "complete",
          skillTemplate: { templateId: selectedId },
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      const next = (await res.json()) as OnboardingState;
      onAdvance(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save template choice.");
    } finally {
      setSubmitting(false);
    }
  }, [onAdvance, selectedId]);

  return (
    <div className="space-y-7">
      <div>
        <h1
          className="font-instrument text-[34px] leading-[1.1] tracking-tight"
          style={{ color: "var(--color-text)" }}
        >
          Choose your first GTM skill.
        </h1>
        <p
          className="mt-3 text-[13.5px] leading-relaxed"
          style={{ color: "var(--color-text-muted)" }}
        >
          Pick one concrete workflow. DenchClaw will open a chat that interviews
          you, then turns your answers into a reusable skill.
        </p>
      </div>

      <div className="space-y-2">
        <label
          htmlFor="skill-template-search"
          className="text-[11px] font-medium uppercase tracking-[0.06em]"
          style={{ color: "var(--color-text-muted)" }}
        >
          Starter gallery
        </label>
        <input
          id="skill-template-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search outreach, meetings, CRM, research..."
          className="h-10 w-full rounded-lg px-3 text-[13px] outline-none transition-[border-color,box-shadow]"
          style={{
            border: "1px solid var(--color-border)",
            background: "var(--color-background)",
            color: "var(--color-text)",
          }}
          onFocus={(event) => {
            event.currentTarget.style.borderColor = "var(--color-accent)";
            event.currentTarget.style.boxShadow =
              "0 0 0 3px color-mix(in oklab, var(--color-accent) 18%, transparent)";
          }}
          onBlur={(event) => {
            event.currentTarget.style.borderColor = "var(--color-border)";
            event.currentTarget.style.boxShadow = "none";
          }}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="max-h-[420px] space-y-5 overflow-y-auto pr-1">
          {groupedTemplates.length > 0 ? (
            groupedTemplates.map((group) => (
              <section key={group.category} className="space-y-2">
                <h2
                  className="text-[11px] font-medium uppercase tracking-[0.06em]"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  {group.category}
                </h2>
                <div className="space-y-2">
                  {group.templates.map((template) => (
                    <TemplateCard
                      key={template.id}
                      template={template}
                      selected={template.id === selectedId}
                      onSelect={() => setSelectedId(template.id)}
                    />
                  ))}
                </div>
              </section>
            ))
          ) : (
            <div
              className="rounded-xl border px-4 py-6 text-[13px]"
              style={{
                borderColor: "var(--color-border)",
                color: "var(--color-text-muted)",
              }}
            >
              No templates match that search.
            </div>
          )}
        </div>

        <SelectedTemplatePanel template={selectedTemplate} />
      </div>

      {error && (
        <p className="text-[12.5px]" style={{ color: "var(--color-error)" }}>
          {error}
        </p>
      )}

      <div className="flex justify-end pt-2">
        <button
          type="button"
          onClick={() => void handleContinue()}
          disabled={submitting}
          className="flex h-10 items-center justify-center rounded-lg px-5 text-[13.5px] font-medium transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-50"
          style={{
            background: "var(--color-accent)",
            color: "#fff",
          }}
          onMouseEnter={(e) => {
            if (!submitting) {
              (e.currentTarget as HTMLElement).style.opacity = "0.92";
            }
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.opacity = "1";
          }}
        >
          {submitting ? "Saving…" : "Start with this"}
        </button>
      </div>
    </div>
  );
}

function TemplateCard({
  template,
  selected,
  onSelect,
}: {
  template: SkillTemplate;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="w-full rounded-xl border p-4 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
      style={{
        borderColor: selected ? "var(--color-accent)" : "var(--color-border)",
        background: selected
          ? "color-mix(in srgb, var(--color-accent) 10%, transparent)"
          : "transparent",
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div
            className="text-[14px] font-medium"
            style={{ color: "var(--color-text)" }}
          >
            {template.title}
          </div>
          <p
            className="mt-1 text-[12.5px] leading-relaxed"
            style={{ color: "var(--color-text-muted)" }}
          >
            {template.summary}
          </p>
        </div>
        <span
          className="mt-0.5 shrink-0 rounded-full px-2 py-1 text-[10.5px] font-medium"
          style={{
            background: selected
              ? "color-mix(in srgb, var(--color-accent) 18%, transparent)"
              : "var(--color-surface-hover)",
            color: selected ? "var(--color-accent)" : "var(--color-text-muted)",
          }}
        >
          {selected ? "Selected" : template.autonomy}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {template.triggerModes.map((mode) => (
          <Badge key={mode}>{mode === "scheduled" ? "Cron-ready" : "Manual"}</Badge>
        ))}
        <Badge>{template.autonomy}</Badge>
      </div>
    </button>
  );
}

function SelectedTemplatePanel({ template }: { template: SkillTemplate }) {
  return (
    <aside
      className="rounded-2xl border p-4"
      style={{
        borderColor: "var(--color-border)",
        background: "var(--color-surface-hover)",
      }}
    >
      <p
        className="text-[11px] font-medium uppercase tracking-[0.06em]"
        style={{ color: "var(--color-text-muted)" }}
      >
        Your first workflow
      </p>
      <h2
        className="mt-2 font-instrument text-[22px] leading-tight tracking-tight"
        style={{ color: "var(--color-text)" }}
      >
        {template.title}
      </h2>
      <p
        className="mt-3 text-[12.5px] leading-relaxed"
        style={{ color: "var(--color-text-muted)" }}
      >
        {template.outcome}
      </p>
      <div className="mt-4 flex flex-wrap gap-1.5">
        <Badge>{template.category}</Badge>
        {template.triggerModes.map((mode) => (
          <Badge key={mode}>{mode === "scheduled" ? "Cron" : "Manual"}</Badge>
        ))}
      </div>
      <div className="mt-5 space-y-2">
        <p
          className="text-[11px] font-medium uppercase tracking-[0.06em]"
          style={{ color: "var(--color-text-muted)" }}
        >
          The agent will ask about
        </p>
        <ul className="space-y-2">
          {template.interviewTopics.slice(0, 4).map((topic) => (
            <li key={topic} className="flex gap-2 text-[12px] leading-relaxed">
              <span
                className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: "var(--color-accent)" }}
              />
              <span style={{ color: "var(--color-text-muted)" }}>{topic}</span>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}

function Badge({ children }: { children: ReactNode }) {
  return (
    <span
      className="rounded-full px-2 py-1 text-[10.5px] font-medium"
      style={{
        background: "color-mix(in srgb, var(--color-text) 8%, transparent)",
        color: "var(--color-text-muted)",
      }}
    >
      {children}
    </span>
  );
}
