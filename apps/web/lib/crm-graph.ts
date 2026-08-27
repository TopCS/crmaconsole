/**
 * Read-only property-graph projection over the workspace DuckDB (EAV schema).
 *
 * The workspace stores CRM data as Entity-Attribute-Value tables:
 *   - `objects`  → entity types (people, company, task, …)
 *   - `entries`  → records (these are the graph VERTICES)
 *   - `fields`   → field definitions; `type='relation'` fields carry a
 *                  `related_object_id` + `relationship_type`
 *   - `entry_fields` → field values; for a relation field, `value` is the
 *                  target `entry_id` (many_to_one) or a JSON array of
 *                  entry ids (many_to_many)
 *
 * We project this into a graph WITHOUT altering any table: vertices are
 * `entries`, edges are the `relation` rows. This is intentionally pure SQL —
 * it works on every DuckDB version (1.3.x, 1.4.x, 1.5.x) and needs no
 * extension or separate engine. LadybugDB is the planned opt-in graph engine;
 * a follow-up spike must first verify it can ATTACH DuckDB views read-only.
 *
 * All access is read-only (`duckdbQueryAsync` runs SELECT-only queries).
 */

import { duckdbQueryAsync } from "./workspace";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The CRM object names that may appear as vertex types. */
export const KNOWN_OBJECT_TYPES = [
  "people",
  "company",
  "task",
  "email_thread",
  "email_message",
  "calendar_event",
  "interaction",
  "segment",
  "campaign",
  "campaign_send",
  "product",
  "order",
] as const;

export type CrmObjectType = (typeof KNOWN_OBJECT_TYPES)[number];

export type GraphNode = {
  id: string;
  /** Object name (people, company, …). */
  type: string;
  /** Human label derived from the entry's name-ish field. */
  label: string;
};

export type GraphEdge = {
  /** Owning entry id (where the relation field lives). */
  source: string;
  /** Referenced entry id. */
  target: string;
  /** Relation field name (e.g. "Company", "Participants"). */
  type: string;
  /** `many_to_one` | `many_to_many`. */
  rel: string;
};

export type CrmGraph = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** True when the node list was capped (see MAX_NODES). */
  truncated: boolean;
};

export type GraphNodeDetail = {
  id: string;
  type: string;
  label: string;
  fields: Array<{ name: string; type: string; value: string | null }>;
};

// ---------------------------------------------------------------------------
// SQL (read-only)
// ---------------------------------------------------------------------------

const MAX_NODES = 2000;

/**
 * Human label, derived from the entry's most specific "name-ish" field in
 * priority order. `COALESCE` over per-field `MAX(...)` picks the first
 * non-null (highest-priority) field; a plain `MAX(CASE WHEN name IN (...))`
 * would wrongly select the alphabetically-largest *value* (e.g. an email
 * address over a person's name), so we keep one aggregate per field.
 */
const LABEL_SQL = `
  COALESCE(
    MAX(CASE WHEN f.name = 'Full Name' THEN ef.value END),
    MAX(CASE WHEN f.name = 'Company Name' THEN ef.value END),
    MAX(CASE WHEN f.name = 'Name' THEN ef.value END),
    MAX(CASE WHEN f.name = 'Title' THEN ef.value END),
    MAX(CASE WHEN f.name = 'Subject' THEN ef.value END),
    MAX(CASE WHEN f.name = 'Email' THEN ef.value END),
    MAX(CASE WHEN f.name = 'Email Address' THEN ef.value END),
    o.name || ' #' || left(e.id, 6)
  )`;

const NODES_SQL = `
  SELECT
    e.id AS id,
    o.name AS type,
    ${LABEL_SQL} AS label
  FROM entries e
  JOIN objects o ON o.id = e.object_id
  LEFT JOIN entry_fields ef ON ef.entry_id = e.id
  LEFT JOIN fields f ON f.id = ef.field_id
  GROUP BY e.id, o.id, o.name
`;

/**
 * Edges = relation rows. `many_to_one` values are scalar target ids;
 * `many_to_many` values are JSON arrays of target ids (unnested). Dangling
 * references (partial syncs) are filtered so the UI never sees an edge that
 * points at a missing node; `json_valid` guards the JSON unnest so a single
 * malformed value cannot abort the whole query.
 */
const EDGES_SQL = `
  WITH edges AS (
    SELECT
      ef.entry_id AS source,
      ef.value AS target,
      f.name AS type,
      f.relationship_type AS rel
    FROM entry_fields ef
    JOIN fields f ON f.id = ef.field_id
    WHERE f.type = 'relation'
      AND f.relationship_type = 'many_to_one'
      AND ef.value IS NOT NULL
      AND ef.value <> ''
      AND ef.value IN (SELECT id FROM entries)

    UNION ALL

    SELECT
      ef.entry_id AS source,
      u.v AS target,
      f.name AS type,
      f.relationship_type AS rel
    FROM entry_fields ef
    JOIN fields f ON f.id = ef.field_id,
         unnest(from_json(ef.value, '["VARCHAR"]')) AS u(v)
    WHERE f.type = 'relation'
      AND f.relationship_type = 'many_to_many'
      AND ef.value IS NOT NULL
      AND ef.value <> ''
      AND json_valid(ef.value)
      AND u.v IN (SELECT id FROM entries)
  )
  SELECT source, target, type, rel
  FROM edges
  WHERE source IN (SELECT id FROM entries)
`;

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

export async function fetchGraphNodes(): Promise<GraphNode[]> {
  return duckdbQueryAsync<GraphNode>(NODES_SQL);
}

export async function fetchGraphEdges(): Promise<GraphEdge[]> {
  return duckdbQueryAsync<GraphEdge>(EDGES_SQL);
}

/** Resolve a `focus` hint (id or label) to a node id, or null. */
function resolveFocusNodeId(
  nodes: GraphNode[],
  focus: string,
): string | null {
  const trimmed = focus.trim();
  if (!trimmed) {return null;}

  // Exact id match first.
  const byId = nodes.find((n) => n.id === trimmed);
  if (byId) {return byId.id;}

  // Then case-insensitive exact label, then substring.
  const lower = trimmed.toLowerCase();
  const byLabel = nodes.find((n) => n.label.toLowerCase() === lower);
  if (byLabel) {return byLabel.id;}
  const bySubstring = nodes.find((n) => n.label.toLowerCase().includes(lower));
  if (bySubstring) {return bySubstring.id;}

  // Word-order-independent match: all focus tokens must appear in the label
  // (e.g. "galaxy samsung" → "Samsung Galaxy S26").
  const tokens = lower.split(/\s+/).filter((t) => t.length > 2);
  if (tokens.length > 1) {
    const byTokens = nodes.find((n) => {
      const l = n.label.toLowerCase();
      return tokens.every((t) => l.includes(t));
    });
    if (byTokens) {return byTokens.id;}
  }

  return null;
}

/** Restrict to the `depth`-hop neighborhood of `focusId`. */
function restrictToNeighborhood(
  nodes: GraphNode[],
  edges: GraphEdge[],
  focusId: string,
  depth: number,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  if (!nodeById.has(focusId)) {return { nodes, edges };}

  const adjacency = new Map<string, string[]>();
  for (const e of edges) {
    for (const [from, to] of [[e.source, e.target], [e.target, e.source]] as const) {
      const list = adjacency.get(from) ?? [];
      list.push(to);
      adjacency.set(from, list);
    }
  }

  const visited = new Set<string>([focusId]);
  let frontier = [focusId];
  for (let hop = 0; hop < depth; hop += 1) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const neighbor of adjacency.get(id) ?? []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          next.push(neighbor);
        }
      }
    }
    frontier = next;
    if (frontier.length === 0) {break;}
  }

  const kept = nodes.filter((n) => visited.has(n.id));
  const keptEdges = edges.filter((e) => visited.has(e.source) && visited.has(e.target));
  return { nodes: kept, edges: keptEdges };
}

export type CrmGraphOptions = {
  /** Restrict to these object names (vertex types). */
  types?: string[];
  /** Focus entry id or label; with `depth`, restrict to its neighborhood. */
  focus?: string;
  /** Hop depth for `focus` (1–3). Ignored without `focus`. */
  depth?: number;
};

export async function fetchCrmGraph(opts: CrmGraphOptions = {}): Promise<CrmGraph> {
  let nodes = await fetchGraphNodes();
  let edges = await fetchGraphEdges();

  // Focus + hop depth (application-side BFS; simpler + safer than a recursive CTE).
  // Resolved against the FULL node list, before any type filtering, so a
  // focus label of one type can center a neighborhood that spans other types.
  let focusId: string | null = null;
  if (opts.focus) {
    focusId = resolveFocusNodeId(nodes, opts.focus);
    if (focusId) {
      const depth = Math.max(1, Math.min(3, Math.floor(opts.depth ?? 1)));
      const restricted = restrictToNeighborhood(nodes, edges, focusId, depth);
      nodes = restricted.nodes;
      edges = restricted.edges;
    }
  }

  // Type filter (server-side, caps payload). The focus node is always
  // retained so a focused subgraph stays anchored even when its own type
  // isn't in the requested type list (e.g. "people connected to Acme").
  const types = (opts.types ?? []).filter((t): t is string => KNOWN_OBJECT_TYPES.includes(t as CrmObjectType));
  if (types.length > 0) {
    const allowed = new Set(types);
    const keptIds = new Set(
      nodes
        .filter((n) => allowed.has(n.type) || (focusId !== null && n.id === focusId))
        .map((n) => n.id),
    );
    nodes = nodes.filter((n) => keptIds.has(n.id));
    edges = edges.filter((e) => keptIds.has(e.source) && keptIds.has(e.target));
  }

  // Hard cap so a large workspace can't blow up the client.
  let truncated = false;
  if (nodes.length > MAX_NODES) {
    truncated = true;
    const keptIds = new Set(nodes.slice(0, MAX_NODES).map((n) => n.id));
    nodes = nodes.filter((n) => keptIds.has(n.id));
    edges = edges.filter((e) => keptIds.has(e.source) && keptIds.has(e.target));
  }

  return { nodes, edges, truncated };
}

/** Full field map for a single entry — fetched lazily on node click. */
export async function fetchGraphNodeDetail(entryId: string): Promise<GraphNodeDetail | null> {
  const safeId = entryId.replace(/'/g, "''");
  const base = await duckdbQueryAsync<{ type: string; label: string }>(`
    SELECT
      o.name AS type,
      ${LABEL_SQL} AS label
    FROM entries e
    JOIN objects o ON o.id = e.object_id
    LEFT JOIN entry_fields ef ON ef.entry_id = e.id
    LEFT JOIN fields f ON f.id = ef.field_id
    WHERE e.id = '${safeId}'
    GROUP BY e.id, o.id, o.name
  `);
  if (base.length === 0) {return null;}

  const fields = await duckdbQueryAsync<{ name: string; type: string; value: string | null }>(`
    SELECT f.name AS name, f.type AS type, ef.value AS value
    FROM entry_fields ef
    JOIN fields f ON f.id = ef.field_id
    WHERE ef.entry_id = '${safeId}'
    ORDER BY f.sort_order, f.name
  `);

  return {
    id: entryId,
    type: base[0].type,
    label: base[0].label,
    fields,
  };
}
