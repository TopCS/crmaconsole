/**
 * Natural-language → structured graph filter.
 *
 * The UI lets a CRM manager type a plain-language query ("mostrami le persone
 * collegate ad Acme entro 2 hop"). This module turns that into a small,
 * SQL-safe filter object:
 *
 *   { types: string[], labelSearch: string|null, focusLabel: string|null, depth: number|null }
 *
 * Two translators exist:
 *   1. LLM (OpenRouter) — the primary path, wired in the route handler.
 *   2. `heuristicGraphFilter` — a dependency-free keyword fallback used when
 *      no API key is configured or the LLM call fails, so the feature degrades
 *      gracefully instead of crashing.
 *
 * Hard contract: nothing returned here is ever interpolated into SQL. `types`
 * is whitelist-checked, `depth` is clamped, and `labelSearch`/`focusLabel` are
 * only ever matched against node labels in application code.
 */

import { KNOWN_OBJECT_TYPES, type CrmObjectType } from "./crm-graph";

export type GraphFilter = {
  /** Object names to keep (subset of KNOWN_OBJECT_TYPES). */
  types: string[];
  /** Substring to match against node labels (client-side highlight/filter). */
  labelSearch: string | null;
  /** A label the user wants to focus on; resolved to a node by the graph layer. */
  focusLabel: string | null;
  /** Hop depth for the focus (1–3). */
  depth: number | null;
};

export const EMPTY_GRAPH_FILTER: GraphFilter = {
  types: [],
  labelSearch: null,
  focusLabel: null,
  depth: null,
};

const TYPE_KEYWORDS: Array<{ type: CrmObjectType; words: string[] }> = [
  { type: "people", words: ["people", "person", "contact", "contacts", "persone", "persona", "contatti", "contatto"] },
  { type: "company", words: ["company", "companies", "azienda", "aziende", "cliente", "clienti", "account"] },
  { type: "task", words: ["task", "tasks", "attività", "attivita", "todo", "todos"] },
  { type: "email_thread", words: ["thread", "threads", "email thread", "conversazione", "conversazioni"] },
  { type: "email_message", words: ["email", "emails", "message", "messages", "messaggio", "messaggi", "mail"] },
  { type: "calendar_event", words: ["event", "events", "meeting", "meetings", "appuntamento", "appuntamenti", "riunione", "riunioni", "calendar"] },
  { type: "interaction", words: ["interaction", "interactions", "interazione", "interazioni", "attività recenti"] },
  { type: "segment", words: ["segment", "segments", "segmento", "segmenti"] },
  { type: "campaign", words: ["campaign", "campaigns", "campagna", "campagne"] },
  { type: "campaign_send", words: ["send", "sends", "invio", "invii", "campaign send"] },
];

/** Normalize/validate an arbitrary object into a safe GraphFilter. */
export function normalizeGraphFilter(raw: unknown): GraphFilter {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out: GraphFilter = { ...EMPTY_GRAPH_FILTER };

  if (Array.isArray(obj.types)) {
    out.types = obj.types
      .map((t) => (typeof t === "string" ? t.trim().toLowerCase() : ""))
      .filter((t): t is CrmObjectType => KNOWN_OBJECT_TYPES.includes(t as CrmObjectType));
    // de-dupe, preserve order
    out.types = Array.from(new Set(out.types));
  }

  out.labelSearch = typeof obj.labelSearch === "string" && obj.labelSearch.trim() ? obj.labelSearch.trim().slice(0, 200) : null;
  out.focusLabel = typeof obj.focusLabel === "string" && obj.focusLabel.trim() ? obj.focusLabel.trim().slice(0, 200) : null;

  if (typeof obj.depth === "number" && Number.isFinite(obj.depth)) {
    out.depth = Math.max(1, Math.min(3, Math.floor(obj.depth)));
  }

  return out;
}

/** Tolerant JSON extraction from an LLM reply (strips code fences, finds first {...}). */
export function parseGraphFilterJson(text: string): GraphFilter {
  let candidate = text.trim();
  // Strip ```json ... ``` fences.
  const fenced = candidate.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {candidate = fenced[1].trim();}
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start !== -1 && end > start) {
    candidate = candidate.slice(start, end + 1);
  }
  try {
    return normalizeGraphFilter(JSON.parse(candidate));
  } catch {
    return EMPTY_GRAPH_FILTER;
  }
}

export function heuristicGraphFilter(query: string): GraphFilter {
  const out: GraphFilter = { ...EMPTY_GRAPH_FILTER };
  const text = query.trim();
  if (!text) {return out;}

  const lower = text.toLowerCase();

  // 1) entity types
  const types: CrmObjectType[] = [];
  for (const entry of TYPE_KEYWORDS) {
    if (entry.words.some((w) => lower.includes(w))) {
      types.push(entry.type);
    }
  }
  out.types = Array.from(new Set(types));

  // 2) hop depth ("2 hop", "entro 2 livelli", "depth 2")
  const depthMatch = text.match(/(?:(\d+)\s*(?:hops?|livell\w*|grad\w*|pass\w*|salt\w*|depth)|(?:hops?|livell\w*|grad\w*|pass\w*|salt\w*|depth)\s*(\d+))/i);
  if (depthMatch) {
    const d = Number(depthMatch[1] ?? depthMatch[2]);
    if (Number.isFinite(d)) {out.depth = Math.max(1, Math.min(3, d));}
  }

  // 3) focus phrase ("collegate ad Acme", "connected to Sarah", "intorno a X")
  const focusMatch = text.match(/(?:collegat[oei]?\s*(?:ad?|con|a)|connected\s+to|neighbors?\s+of|around|near|intorno\s+a|vicino\s+a|da\s+)\s+([A-Za-z0-9À-ÿ .'’&+-]{2,60})/i);
  if (focusMatch) {
    out.focusLabel = focusMatch[1]
      .trim()
      .replace(/[.]+$/, "")
      .replace(/\s+(?:entro|within|in)\s+\d*\s*(?:hops?|livell\w*|grad\w*|pass\w*|salt\w*|depth).*$/i, "")
      .replace(/\s+\d+\s*(?:hops?|livell\w*|grad\w*|pass\w*|salt\w*|depth).*$/i, "")
      .trim();
  }

  return out;
}
