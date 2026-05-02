"use client";

import { useCallback, useState } from "react";
import type { OnboardingState } from "@/lib/denchclaw-state";
import {
  SKILL_TEMPLATES,
  isSkillTemplateId,
  type SkillTemplateId,
} from "@/lib/skill-templates";

function initialTemplateId(state: OnboardingState): SkillTemplateId {
  const persisted = state.skillTemplate?.templateId;
  return isSkillTemplateId(persisted) ? persisted : SKILL_TEMPLATES[0].id;
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
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    <div className="space-y-8">
      <div>
        <h1
          className="font-instrument text-[34px] leading-[1.1] tracking-tight"
          style={{ color: "var(--color-text)" }}
        >
          Pick a starter skill.
        </h1>
        <p
          className="mt-3 text-[13.5px] leading-relaxed"
          style={{ color: "var(--color-text-muted)" }}
        >
          We&apos;ll use this to open your first chat with a concrete next step.
          You can change or ignore it later.
        </p>
      </div>

      <div className="space-y-3">
        {SKILL_TEMPLATES.map((template) => {
          const selected = template.id === selectedId;
          return (
            <button
              key={template.id}
              type="button"
              onClick={() => setSelectedId(template.id)}
              className="w-full rounded-xl border p-4 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
              style={{
                borderColor: selected ? "var(--color-accent)" : "var(--color-border)",
                background: selected
                  ? "color-mix(in srgb, var(--color-accent) 10%, transparent)"
                  : "transparent",
              }}
            >
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
            </button>
          );
        })}
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
