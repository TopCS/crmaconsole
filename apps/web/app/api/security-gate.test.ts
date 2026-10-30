import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/crm-queries", () => ({
  buildEntryProjection: vi.fn(() => "SELECT 1 AS entry_id"),
  loadCrmFieldMaps: vi.fn(async () => ({ people: {} })),
  safeQuery: vi.fn(async () => []),
  wrapForOrderedAccess: vi.fn((sql: string) => sql),
  sqlString: (v: string) => `'${v}'`,
}));
vi.mock("@/lib/workspace-schema-migrations", () => ({
  ONBOARDING_OBJECT_IDS: { people: "p", interaction: "i" },
}));
vi.mock("@/lib/crm-graph", () => ({
  fetchCrmGraph: vi.fn(async () => ({ nodes: [], edges: [], truncated: false })),
  fetchGraphNodeDetail: vi.fn(async () => ({ entry: null })),
}));
vi.mock("@/lib/workspace", () => ({
  duckdbQueryAsync: vi.fn(async () => []),
  resolveOpenClawStateDir: () => "/tmp/state",
  resolveWorkspaceRoot: () => "/tmp/state/workspace",
}));
vi.mock("node:fs", () => ({
  readFileSync: vi.fn(() => ""),
  readdirSync: vi.fn(() => []),
  existsSync: vi.fn(() => false),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

const people = await import("./crm/people/route");
const graph = await import("./crm/graph/route");
const graphNode = await import("./crm/graph/node/route");
const memories = await import("./memories/route");
const workspaceQuery = await import("./workspace/query/route");
const workspaceExecute = await import("./workspace/execute/route");

const SECRET = "test-session-secret-value-1234";
const originalSecret = process.env.CRM_A_SESSION_SECRET;

beforeEach(() => {
  process.env.CRM_A_SESSION_SECRET = SECRET;
});

afterEach(() => {
  if (originalSecret === undefined) {delete process.env.CRM_A_SESSION_SECRET;}
  else {process.env.CRM_A_SESSION_SECRET = originalSecret;}
});

function get(url: string): Request {
  return new Request(url);
}
function post(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("SEC-001: CRM routes deny anonymous callers", () => {
  it("GET /api/crm/people → 401", async () => {
    const res = await people.GET(get("http://localhost/api/crm/people"));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });
});

describe("SEC-002: graph and memories deny anonymous callers", () => {
  it("GET /api/crm/graph → 401", async () => {
    const res = await graph.GET(get("http://localhost/api/crm/graph"));
    expect(res.status).toBe(401);
  });

  it("GET /api/crm/graph/node → 401", async () => {
    const res = await graphNode.GET(get("http://localhost/api/crm/graph/node?entryId=x"));
    expect(res.status).toBe(401);
  });

  it("GET /api/memories → 401", async () => {
    const res = await memories.GET(get("http://localhost/api/memories"));
    expect(res.status).toBe(401);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.mainMemory).toBeUndefined();
  });
});

describe("SEC-003/005: SQL routes deny anonymous and reject unsafe SQL", () => {
  it("POST /api/workspace/query → 401", async () => {
    const res = await workspaceQuery.POST(
      post("http://localhost/api/workspace/query", { sql: "SELECT 1" }),
    );
    expect(res.status).toBe(401);
  });

  it("POST /api/workspace/execute → 401", async () => {
    const res = await workspaceExecute.POST(
      post("http://localhost/api/workspace/execute", { sql: "SELECT 1" }),
    );
    expect(res.status).toBe(401);
  });
});
