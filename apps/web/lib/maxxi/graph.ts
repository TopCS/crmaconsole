/**
 * MAXXI relationship graph — read-only projection over the isolated demo DB.
 *
 * This intentionally mirrors the shape of the main CRM graph (nodes + edges +
 * lazy node detail) but never reads the shared workspace database and never
 * exposes infopoint notes. Callers must pass the `maxxi.people.read` guard.
 */

import { getPerson360, listReviewCandidates } from "./queries";
import { maxxiDbPath, maxxiQuery } from "./store";

export const MAXXI_GRAPH_TYPES = [
  "person",
  "organization",
  "catalog",
  "interest",
  "source",
] as const;

export type MaxxiGraphType = (typeof MAXXI_GRAPH_TYPES)[number];

export type MaxxiGraphNode = {
  id: string;
  label: string;
  type: MaxxiGraphType;
};

export type MaxxiGraphEdge = {
  source: string;
  target: string;
  /** Human-readable relation label, e.g. "Visita" or "Fonte". */
  type: string;
  /** Machine relation kind, e.g. "event" / "identity" / "duplicate". */
  rel: string;
};

export type MaxxiGraph = {
  nodes: MaxxiGraphNode[];
  edges: MaxxiGraphEdge[];
  truncated: boolean;
};

export type MaxxiGraphRelation = {
  id: string;
  label: string;
  type: string;
  edgeType: string;
  direction: "out" | "in";
};

export type MaxxiGraphNodeDetail = {
  id: string;
  type: string;
  label: string;
  fields: Array<{ name: string; type: string; value: string | null }>;
  relations: MaxxiGraphRelation[];
};

const MAX_NODES = 500;
const MAX_DEPTH = 3;

function slug(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function eventLabel(type: string): string | null {
  switch (type) {
    case "museum_visit_attended": return "Visita";
    case "exhibition_ticket_purchased": return "Acquisto";
    default: return null;
  }
}

export type MaxxiGraphOptions = {
  types?: string[];
  focus?: string;
  depth?: number;
};

/** Build the complete demo graph (small by design: tens of nodes). */
export async function buildMaxxiGraph(): Promise<MaxxiGraph> {
  const [people, organizations, catalog, interests, sources, links, relationships, events, reviews] =
    await Promise.all([
      maxxiQuery<{ person_id: string; name: string }>(
        `SELECT person_id, name FROM maxxi_person ORDER BY name;`,
      ),
      maxxiQuery<{ organization_id: string; name: string; relationship_kind: string }>(
        `SELECT organization_id, name, relationship_kind FROM maxxi_organization ORDER BY name;`,
      ),
      maxxiQuery<{ catalog_id: string; title: string; type: string }>(
        `SELECT catalog_id, title, type FROM maxxi_catalog_item ORDER BY start_date;`,
      ),
      maxxiQuery<{ interest: string }>(
        `SELECT DISTINCT interest FROM maxxi_person_interest WHERE kind = 'explicit' ORDER BY interest;`,
      ),
      maxxiQuery<{ source_system: string; description: string; mock_or_live: string; row_count: number | string; quarantined_count: number | string }>(
        `SELECT source_system, description, mock_or_live, row_count, quarantined_count
           FROM maxxi_source_registry ORDER BY source_system;`,
      ),
      maxxiQuery<{ person_id: string; source_system: string }>(
        `SELECT DISTINCT person_id, source_system FROM maxxi_identity_link WHERE status = 'linked';`,
      ),
      maxxiQuery<{ person_id: string; organization_id: string; type: string }>(
        `SELECT person_id, organization_id, type FROM maxxi_relationship;`,
      ),
      maxxiQuery<{ person_id: string; type: string; catalog_item_id: string }>(
        `SELECT person_id, type, catalog_item_id FROM maxxi_event
          WHERE person_id IS NOT NULL AND catalog_item_id IS NOT NULL;`,
      ),
      listReviewCandidates(),
    ]);

  const nodes: MaxxiGraphNode[] = [];
  const nodeIds = new Set<string>();
  const addNode = (node: MaxxiGraphNode) => {
    if (nodeIds.has(node.id)) {return;}
    nodeIds.add(node.id);
    nodes.push(node);
  };

  const nameCounts = new Map<string, number>();
  for (const person of people) {
    nameCounts.set(person.name.toLowerCase(), (nameCounts.get(person.name.toLowerCase()) ?? 0) + 1);
  }

  for (const person of people) {
    const duplicateName = (nameCounts.get(person.name.toLowerCase()) ?? 0) > 1;
    addNode({
      id: person.person_id,
      label: duplicateName ? `${person.name} (${person.person_id})` : person.name,
      type: "person",
    });
  }
  for (const org of organizations) {
    addNode({ id: org.organization_id, label: org.name, type: "organization" });
  }
  for (const item of catalog) {
    addNode({ id: item.catalog_id, label: item.title, type: "catalog" });
  }
  for (const row of interests) {
    addNode({
      id: `interest:${slug(row.interest)}`,
      label: row.interest.charAt(0).toUpperCase() + row.interest.slice(1),
      type: "interest",
    });
  }
  for (const source of sources) {
    addNode({
      id: `source:${source.source_system}`,
      label: source.source_system,
      type: "source",
    });
  }

  const edges: MaxxiGraphEdge[] = [];
  const seenEdges = new Set<string>();
  const addEdge = (edge: MaxxiGraphEdge) => {
    const key = `${edge.source}|${edge.target}|${edge.rel}|${edge.type}`;
    if (seenEdges.has(key)) {return;}
    seenEdges.add(key);
    edges.push(edge);
  };

  for (const link of links) {
    addEdge({
      source: link.person_id,
      target: `source:${link.source_system}`,
      type: "Fonte",
      rel: "identity",
    });
  }

  const interestMembers = await Promise.all(
    interests.map(async (row) => ({
      interestId: `interest:${slug(row.interest)}`,
      members: await maxxiQuery<{ person_id: string }>(
        `SELECT person_id FROM maxxi_person_interest
          WHERE kind = 'explicit' AND interest = '${row.interest.replace(/'/g, "''")}';`,
      ),
    })),
  );
  for (const group of interestMembers) {
    for (const member of group.members) {
      addEdge({
        source: member.person_id,
        target: group.interestId,
        type: "Interesse",
        rel: "interest",
      });
    }
  }

  for (const relationship of relationships) {
    addEdge({
      source: relationship.person_id,
      target: relationship.organization_id,
      type: relationship.type === "contact_of" ? "Contatto" : relationship.type,
      rel: "relationship",
    });
  }

  for (const event of events) {
    const type = eventLabel(event.type);
    if (!type) {continue;}
    addEdge({
      source: event.person_id,
      target: event.catalog_item_id,
      type,
      rel: "event",
    });
  }

  // Review candidates are not a separate node: a same-name review becomes a
  // "possible duplicate" edge between the two people. It is explicitly not a
  // confirmed identity link.
  const byName = new Map<string, string[]>();
  for (const person of people) {
    const key = person.name.toLowerCase();
    byName.set(key, [...(byName.get(key) ?? []), person.person_id]);
  }
  for (const candidate of reviews) {
    const matches = byName.get(candidate.name.toLowerCase()) ?? [];
    if (matches.length < 2) {continue;}
    for (let index = 1; index < matches.length; index += 1) {
      addEdge({
        source: matches[0],
        target: matches[index],
        type: "Possibile duplicato",
        rel: "duplicate",
      });
    }
  }

  let truncated = false;
  if (nodes.length > MAX_NODES) {
    truncated = true;
    nodes.length = MAX_NODES;
  }
  const kept = new Set(nodes.map((node) => node.id));
  return {
    nodes,
    edges: edges.filter((edge) => kept.has(edge.source) && kept.has(edge.target)),
    truncated,
  };
}

function resolveFocus(nodes: MaxxiGraphNode[], focus: string): string | null {
  const trimmed = focus.trim();
  if (!trimmed) {return null;}
  const exactId = nodes.find((node) => node.id === trimmed);
  if (exactId) {return exactId.id;}
  const lower = trimmed.toLowerCase();
  const exactLabel = nodes.find((node) => node.label.toLowerCase() === lower);
  if (exactLabel) {return exactLabel.id;}
  return nodes.find((node) => node.label.toLowerCase().includes(lower))?.id ?? null;
}

function restrictToNeighborhood(
  graph: MaxxiGraph,
  focusId: string,
  depth: number,
): MaxxiGraph {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  if (!nodeById.has(focusId)) {return graph;}

  const adjacency = new Map<string, string[]>();
  for (const edge of graph.edges) {
    for (const [from, to] of [[edge.source, edge.target], [edge.target, edge.source]] as const) {
      adjacency.set(from, [...(adjacency.get(from) ?? []), to]);
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

  const nodes = graph.nodes.filter((node) => visited.has(node.id));
  const kept = new Set(nodes.map((node) => node.id));
  return {
    nodes,
    edges: graph.edges.filter((edge) => kept.has(edge.source) && kept.has(edge.target)),
    truncated: graph.truncated,
  };
}

export function filterMaxxiGraph(graph: MaxxiGraph, options: MaxxiGraphOptions = {}): MaxxiGraph {
  let result = graph;
  const focusId = options.focus ? resolveFocus(result.nodes, options.focus) : null;
  if (focusId) {
    const depth = Math.max(1, Math.min(MAX_DEPTH, Math.floor(options.depth ?? 1)));
    result = restrictToNeighborhood(result, focusId, depth);
  }

  const types = (options.types ?? []).filter((type): type is MaxxiGraphType =>
    (MAXXI_GRAPH_TYPES as readonly string[]).includes(type),
  );
  if (types.length === 0) {return result;}

  const allowed = new Set(types);
  const directNeighbors = new Set<string>();
  if (focusId) {
    for (const edge of result.edges) {
      if (edge.source === focusId) {directNeighbors.add(edge.target);}
      if (edge.target === focusId) {directNeighbors.add(edge.source);}
    }
  }
  const kept = new Set(
    result.nodes
      .filter((node) => allowed.has(node.type) || (focusId != null && (node.id === focusId || directNeighbors.has(node.id))))
      .map((node) => node.id),
  );
  return {
    nodes: result.nodes.filter((node) => kept.has(node.id)),
    edges: result.edges.filter((edge) => kept.has(edge.source) && kept.has(edge.target)),
    truncated: result.truncated,
  };
}

const GRAPH_TTL_MS = 10_000;
let graphCache: { key: string; at: number; data: MaxxiGraph } | null = null;

export function clearMaxxiGraphCache(): void {
  graphCache = null;
}

export async function getMaxxiGraph(): Promise<MaxxiGraph> {
  const key = maxxiDbPath();
  if (graphCache && graphCache.key === key && Date.now() - graphCache.at < GRAPH_TTL_MS) {
    return graphCache.data;
  }
  const data = await buildMaxxiGraph();
  graphCache = { key, at: Date.now(), data };
  return data;
}

export async function getMaxxiGraphNodeDetail(id: string): Promise<MaxxiGraphNodeDetail | null> {
  const graph = await getMaxxiGraph();
  const node = graph.nodes.find((candidate) => candidate.id === id);
  if (!node) {return null;}

  const fields: Array<{ name: string; type: string; value: string | null }> = [];

  if (node.type === "person") {
    const person = await getPerson360(id);
    if (!person) {return null;}
    fields.push(
      { name: "Nome", type: "text", value: person.person.name },
      { name: "Email", type: "text", value: person.person.email },
      { name: "Lingua", type: "text", value: person.person.language },
      { name: "Identità", type: "text", value: person.dataQuality.identityIsCertain ? "Verificata" : "Da verificare" },
      { name: "Fonti collegate", type: "number", value: String(person.identityLinks.length) },
      { name: "Eventi", type: "number", value: String(person.timeline.length) },
      { name: "Membership", type: "number", value: String(person.memberships.length) },
      { name: "Interessi", type: "text", value: person.person.interestsExplicit.join(", ") || "—" },
      {
        name: "Consensi",
        type: "json",
        value: JSON.stringify(
          person.consents.map((consent) => `${consent.purpose}/${consent.channel}: ${consent.status}`),
        ),
      },
    );
  } else if (node.type === "organization") {
    const rows = await maxxiQuery<{ name: string; relationship_kind: string }>(
      `SELECT name, relationship_kind FROM maxxi_organization WHERE organization_id = '${id.replace(/'/g, "''")}' LIMIT 1;`,
    );
    if (!rows[0]) {return null;}
    const peopleCount = await maxxiQuery<{ n: number | string }>(
      `SELECT COUNT(*) AS n FROM maxxi_relationship WHERE organization_id = '${id.replace(/'/g, "''")}';`,
    );
    fields.push(
      { name: "Organizzazione", type: "text", value: rows[0].name },
      { name: "Tipo relazione", type: "text", value: rows[0].relationship_kind },
      { name: "Persone collegate", type: "number", value: String(peopleCount[0]?.n ?? 0) },
    );
  } else if (node.type === "catalog") {
    const rows = await maxxiQuery<{ title: string; type: string; start_date: string; end_date: string; is_public_real: boolean }>(
      `SELECT title, type, start_date, end_date, is_public_real FROM maxxi_catalog_item WHERE catalog_id = '${id.replace(/'/g, "''")}' LIMIT 1;`,
    );
    if (!rows[0]) {return null;}
    fields.push(
      { name: "Titolo", type: "text", value: rows[0].title },
      { name: "Tipo", type: "text", value: rows[0].type },
      { name: "Periodo", type: "text", value: `${rows[0].start_date} → ${rows[0].end_date}` },
      { name: "Catalogo pubblico reale", type: "text", value: rows[0].is_public_real ? "Sì" : "No" },
    );
  } else if (node.type === "interest") {
    const interest = node.label.toLowerCase();
    const count = await maxxiQuery<{ n: number | string }>(
      `SELECT COUNT(DISTINCT person_id) AS n FROM maxxi_person_interest
        WHERE kind = 'explicit' AND lower(interest) = '${interest.replace(/'/g, "''")}';`,
    );
    fields.push(
      { name: "Interesse", type: "text", value: node.label },
      { name: "Persone con interesse esplicito", type: "number", value: String(count[0]?.n ?? 0) },
    );
  } else if (node.type === "source") {
    const sourceSystem = node.id.slice("source:".length);
    const rows = await maxxiQuery<{ description: string; mock_or_live: string; row_count: number | string; quarantined_count: number | string; last_imported_at: string }>(
      `SELECT description, mock_or_live, row_count, quarantined_count, last_imported_at
         FROM maxxi_source_registry WHERE source_system = '${sourceSystem.replace(/'/g, "''")}' LIMIT 1;`,
    );
    if (!rows[0]) {return null;}
    fields.push(
      { name: "Fonte", type: "text", value: sourceSystem },
      { name: "Descrizione", type: "text", value: rows[0].description },
      { name: "Modalità", type: "text", value: rows[0].mock_or_live },
      { name: "Record", type: "number", value: String(rows[0].row_count) },
      { name: "In revisione", type: "number", value: String(rows[0].quarantined_count) },
      { name: "Ultimo import", type: "text", value: rows[0].last_imported_at },
    );
  }

  const relations: MaxxiGraphRelation[] = [];
  for (const edge of graph.edges) {
    if (edge.source !== id && edge.target !== id) {continue;}
    const otherId = edge.source === id ? edge.target : edge.source;
    const other = graph.nodes.find((candidate) => candidate.id === otherId);
    if (!other) {continue;}
    relations.push({
      id: other.id,
      label: other.label,
      type: other.type,
      edgeType: edge.type,
      direction: edge.source === id ? "out" : "in",
    });
  }

  return {
    id: node.id,
    type: node.type,
    label: node.label,
    fields,
    relations,
  };
}
