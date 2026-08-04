import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/workspace", () => ({
  duckdbQueryAsync: vi.fn(),
  duckdbExecOnFileAsync: vi.fn(async () => true),
  duckdbPathAsync: vi.fn(async () => "/tmp/workspace.duckdb"),
}));

const { getAllowedEventTypes, EVENT_TYPES } = await import("./events");
const { duckdbQueryAsync } = await import("@/lib/workspace");
const mockedQuery = vi.mocked(duckdbQueryAsync);

describe("getAllowedEventTypes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the module-level cache between cases.
    vi.resetModules();
  });

  it("accepts enum values emitted natively as an array (duckdb -json)", async () => {
    mockedQuery.mockResolvedValue([{ enum_values: ["Email", "Newsletter Signup"] }]);
    const types = await getAllowedEventTypes();
    expect(types).toContain("Newsletter Signup");
  });
});

describe("getAllowedEventTypes (fresh module)", () => {
  it("parses enum values stored as a JSON string, and falls back when missing", async () => {
    vi.resetModules();
    const mod = await import("./events");
    mockedQuery.mockResolvedValue([{ enum_values: '["Email","Video View"]' }]);
    expect(await mod.getAllowedEventTypes()).toContain("Video View");

    vi.resetModules();
    const mod2 = await import("./events");
    mockedQuery.mockResolvedValue([]);
    expect(await mod2.getAllowedEventTypes()).toEqual([...EVENT_TYPES]);
  });
});
