"use client";

import { cn } from "@/lib/utils";

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

const TYPE_LABELS: Record<string, string> = {
  people: "Person",
  company: "Company",
  task: "Task",
  email_thread: "Email thread",
  email_message: "Email message",
  calendar_event: "Event",
  interaction: "Interaction",
  segment: "Segment",
  campaign: "Campaign",
  campaign_send: "Campaign send",
};

export function GraphDetailPanel({ detail, loading, onClose }: GraphDetailPanelProps) {
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
      ) : !detail ? (
        <div className="flex flex-1 items-center justify-center px-4 text-center text-sm text-muted-foreground">
          Select a node to inspect its fields.
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-4 py-3">
          <div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
            {TYPE_LABELS[detail.type] ?? detail.type}
          </div>
          <div className="mb-4 text-base font-semibold">{detail.label}</div>

          <dl className="space-y-2">
            {detail.fields.map((field) => (
              <div key={field.name} className="text-sm">
                <dt className="text-xs text-muted-foreground">{field.name}</dt>
                <dd className={cn("mt-0.5 break-words", field.value == null && "italic text-muted-foreground")}>
                  {field.value ?? "—"}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </aside>
  );
}
