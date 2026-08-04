import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/workspace", () => ({
  duckdbQueryAsync: vi.fn(),
  duckdbExecOnFileAsync: vi.fn(async () => true),
  duckdbPathAsync: vi.fn(async () => "/tmp/workspace.duckdb"),
}));
vi.mock("@/lib/segments", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/segments")>();
  return {
    ...original,
    listSegmentMembers: vi.fn(),
    updateSegmentCache: vi.fn(async () => {}),
  };
});

const { GET } = await import("./route");
const { duckdbQueryAsync } = await import("@/lib/workspace");
const { listSegmentMembers, updateSegmentCache } = await import("@/lib/segments");

const mockedQuery = vi.mocked(duckdbQueryAsync);
const mockedMembers = vi.mocked(listSegmentMembers);
const mockedCache = vi.mocked(updateSegmentCache);

describe("/api/crm/segments/[id]/members", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads the segment definition, lists members and refreshes the cache", async () => {
    mockedQuery.mockResolvedValue([
      { filter: JSON.stringify({ events: [{ type: "Page View", operator: "has" }] }), name: "Pricing viewers" },
    ]);
    mockedMembers.mockResolvedValue({
      total: 2,
      members: [
        { entry_id: "p1", name: "Ada", email: "ada@x.co", source: "Manual", strength_score: "5", last_interaction_at: null },
        { entry_id: "p2", name: "Grace", email: "g@x.co", source: "Gmail", strength_score: "2", last_interaction_at: null },
      ],
    });

    const res = await GET(new Request("http://localhost/api/crm/segments/seg-1/members"), {
      params: Promise.resolve({ id: "seg-1" }),
    });

    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload.total).toBe(2);
    expect(payload.members).toHaveLength(2);
    expect(payload.name).toBe("Pricing viewers");
    expect(mockedMembers).toHaveBeenCalledWith(
      { events: [{ type: "Page View", operator: "has" }] },
      expect.objectContaining({ limit: 50 }),
    );
    expect(mockedCache).toHaveBeenCalledWith("seg-1", 2);
  });

  it("404s when the segment does not exist", async () => {
    mockedQuery.mockResolvedValue([]);
    const res = await GET(new Request("http://localhost/api/crm/segments/nope/members"), {
      params: Promise.resolve({ id: "nope" }),
    });
    expect(res.status).toBe(404);
  });

  it("handles a segment without a filter (matches everyone)", async () => {
    mockedQuery.mockResolvedValue([{ filter: null, name: "All" }]);
    mockedMembers.mockResolvedValue({ total: 0, members: [] });
    const res = await GET(new Request("http://localhost/api/crm/segments/seg-1/members"), {
      params: Promise.resolve({ id: "seg-1" }),
    });
    expect(res.status).toBe(200);
    expect(mockedMembers).toHaveBeenCalledWith({}, expect.anything());
  });
});
