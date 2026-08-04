import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/workspace", () => ({
  duckdbQueryAsync: vi.fn(),
  duckdbExecOnFileAsync: vi.fn(async () => true),
  duckdbPathAsync: vi.fn(async () => "/tmp/workspace.duckdb"),
}));
vi.mock("@/lib/crm-queries", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/crm-queries")>();
  return {
    ...original,
    loadCrmFieldMaps: vi.fn(async () => ({
      campaign: { Status: "fld_status", "Sent At": "fld_sent_at", "Recipients Count": "fld_rc" },
    })),
  };
});
vi.mock("@/lib/segments", () => ({
  listSegmentMembers: vi.fn(),
}));
vi.mock("@/lib/crm-a-console-state", () => ({
  readConnections: vi.fn(),
}));
vi.mock("@/lib/composio-execute", () => ({
  executeComposioTool: vi.fn(),
  resolveToolSlug: vi.fn(async () => "GMAIL_SEND_EMAIL"),
}));

const { sendCampaign } = await import("./campaigns");
const { duckdbQueryAsync, duckdbExecOnFileAsync } = await import("@/lib/workspace");
const { listSegmentMembers } = await import("@/lib/segments");
const { readConnections } = await import("@/lib/crm-a-console-state");
const { executeComposioTool } = await import("@/lib/composio-execute");

const mockedQuery = vi.mocked(duckdbQueryAsync);
const mockedExec = vi.mocked(duckdbExecOnFileAsync);
const mockedMembers = vi.mocked(listSegmentMembers);
const mockedConnections = vi.mocked(readConnections);
const mockedTool = vi.mocked(executeComposioTool);

const CAMPAIGN = {
  entry_id: "camp-1",
  Name: "Launch",
  Subject: "Hello",
  Body: "Hi there",
  Segment: "seg-1",
  Status: "Draft",
};

function mockCampaignLoad() {
  mockedQuery.mockImplementation(async (sql: string) => {
    if (sql.includes("v_campaign")) {return [CAMPAIGN];}
    if (sql.includes("v_segment")) {return [{ filter: null }];}
    return [];
  });
}

describe("sendCampaign", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedConnections.mockReturnValue({ gmail: { connectionId: "ca_gmail" } } as never);
    mockCampaignLoad();
  });

  it("sends to every emailable member and marks the campaign sent", async () => {
    mockedMembers.mockResolvedValue({
      total: 3,
      members: [
        { entry_id: "p1", name: "Ada", email: "ada@x.co", source: "Manual", strength_score: null, last_interaction_at: null },
        { entry_id: "p2", name: "NoMail", email: null, source: "Manual", strength_score: null, last_interaction_at: null },
        { entry_id: "p3", name: "Anon", email: "anon@x.co", source: "Anonymous", strength_score: null, last_interaction_at: null },
      ],
    });
    mockedTool.mockResolvedValue({} as never);

    const result = await sendCampaign("camp-1");

    expect(result.sent).toBe(1);
    expect(result.failed).toBe(0);
    expect(mockedTool).toHaveBeenCalledTimes(1);
    expect(mockedTool).toHaveBeenCalledWith(
      expect.objectContaining({
        toolSlug: "GMAIL_SEND_EMAIL",
        connectedAccountId: "ca_gmail",
        arguments: expect.objectContaining({ recipient_email: "ada@x.co", subject: "Hello" }),
      }),
    );
    const sql = mockedExec.mock.calls.map((c) => String(c[1])).join("\n");
    expect(sql).toContain("fld_status");
    expect(sql).toContain("Sent");
    expect(sql).toContain("fld_rc");
  });

  it("fails clearly when there is no Gmail connection", async () => {
    mockedConnections.mockReturnValue({} as never);
    await expect(sendCampaign("camp-1")).rejects.toThrow("No Gmail connection");
    expect(mockedTool).not.toHaveBeenCalled();
  });

  it("requires a segment, subject and body", async () => {
    mockedQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("v_campaign")) {return [{ ...CAMPAIGN, Segment: null }];}
      return [];
    });
    await expect(sendCampaign("camp-1")).rejects.toThrow("no segment");

    mockedQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("v_campaign")) {return [{ ...CAMPAIGN, Subject: "  " }];}
      return [];
    });
    await expect(sendCampaign("camp-1")).rejects.toThrow("no subject");
  });

  it("counts per-recipient failures without aborting the batch", async () => {
    mockedMembers.mockResolvedValue({
      total: 2,
      members: [
        { entry_id: "p1", name: "A", email: "a@x.co", source: "Manual", strength_score: null, last_interaction_at: null },
        { entry_id: "p2", name: "B", email: "b@x.co", source: "Manual", strength_score: null, last_interaction_at: null },
      ],
    });
    mockedTool
      .mockRejectedValueOnce(new Error("quota"))
      .mockResolvedValueOnce({} as never);

    const result = await sendCampaign("camp-1");
    expect(result.sent).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.failures[0]).toEqual({ email: "a@x.co", error: "quota" });
  });
});
