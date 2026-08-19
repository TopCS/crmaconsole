/**
 * Shared metadata + helpers for the CRM relationship graph UI.
 *
 * Pure client-safe data (no server imports) so it can be imported by the
 * canvas, the view, and the detail panel without pulling in DuckDB/fs code.
 */

export type GraphTypeMeta = {
  /** Emoji glyph used in the node canvas + legend. */
  icon: string;
  /** Node fill color (works on both light/dark). */
  color: string;
  /** Human-readable singular label. */
  label: string;
};

const TYPE_META: Record<string, GraphTypeMeta> = {
  people: { icon: "👤", color: "#6366f1", label: "Person" },
  company: { icon: "🏢", color: "#f59e0b", label: "Company" },
  task: { icon: "☑", color: "#22c55e", label: "Task" },
  email_thread: { icon: "🧵", color: "#0ea5e9", label: "Thread" },
  email_message: { icon: "✉", color: "#38bdf8", label: "Email" },
  calendar_event: { icon: "📅", color: "#f43f5e", label: "Event" },
  interaction: { icon: "🔗", color: "#a855f7", label: "Interaction" },
  segment: { icon: "🧩", color: "#14b8a6", label: "Segment" },
  campaign: { icon: "📣", color: "#f97316", label: "Campaign" },
  campaign_send: { icon: "📤", color: "#eab308", label: "Send" },
};

const DEFAULT_META: GraphTypeMeta = { icon: "●", color: "#94a3b8", label: "Entity" };

export function metaForType(type: string | null | undefined): GraphTypeMeta {
  return (type && TYPE_META[type]) || DEFAULT_META;
}

/** Order types so the legend is stable and known types come first. */
export function orderedTypeMeta(types: ReadonlySet<string>): Array<{ type: string; meta: GraphTypeMeta }> {
  const known = Object.keys(TYPE_META);
  const ordered: Array<{ type: string; meta: GraphTypeMeta }> = [];
  for (const type of known) {
    if (types.has(type)) {ordered.push({ type, meta: TYPE_META[type] });}
  }
  for (const type of types) {
    if (!TYPE_META[type]) {ordered.push({ type, meta: DEFAULT_META });}
  }
  return ordered;
}

export function truncateLabel(label: string, max = 22): string {
  return label.length > max ? `${label.slice(0, max)}…` : label;
}

export type GraphTheme = {
  foreground: string;
  muted: string;
  border: string;
  background: string;
};

/**
 * Resolve the app's shadcn theme tokens (stored as HSL triplets, e.g.
 * `0 0% 3.9%`) into concrete colors for the canvas renderer.
 */
export function resolveThemeColors(): GraphTheme {
  const fallback: GraphTheme = {
    foreground: "#1e293b",
    muted: "#94a3b8",
    border: "#e2e8f0",
    background: "#ffffff",
  };
  if (typeof window === "undefined") {return fallback;}

  const cs = getComputedStyle(document.documentElement);
  const read = (name: string, fb: string): string => {
    const raw = cs.getPropertyValue(name).trim();
    if (!raw) {return fb;}
    // shadcn stores HSL as "H S% L%"; a full color starts with '#' or 'rgb'.
    return /^\d/.test(raw) ? `hsl(${raw})` : raw;
  };
  return {
    foreground: read("--foreground", fallback.foreground),
    muted: read("--muted-foreground", fallback.muted),
    border: read("--border", fallback.border),
    background: read("--background", fallback.background),
  };
}
