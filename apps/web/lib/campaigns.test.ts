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
      campaign_send: {
        Campaign: "fld_cs_campaign",
        Person: "fld_cs_person",
        Email: "fld_cs_email",
        Status: "fld_cs_status",
        Attempts: "fld_cs_attempts",
        "Last Attempt At": "fld_cs_last",
        "Next Attempt At": "fld_cs_next",
        "SES Message ID": "fld_cs_ses",
        Error: "fld_cs_error",
      },
      people: { "Email Status": "fld_p_emailstatus" },
    })),
  };
});
vi.mock("@/lib/segments", () => ({
  listSegmentMembers: vi.fn(),
}));
vi.mock("@/lib/ses", () => ({
  sendSesEmail: vi.fn(),
}));

const {
  enqueueCampaign,
  pauseCampaign,
  resumeCampaign,
  cancelCampaign,
  processCampaignQueue,
  handleSesNotification,
} = await import("./campaigns");
const { duckdbQueryAsync, duckdbExecOnFileAsync } = await import("@/lib/workspace");
const { listSegmentMembers } = await import("@/lib/segments");
const { sendSesEmail } = await import("@/lib/ses");

const mockedQuery = vi.mocked(duckdbQueryAsync);
const mockedExec = vi.mocked(duckdbExecOnFileAsync);
const mockedMembers = vi.mocked(listSegmentMembers);
const mockedSes = vi.mocked(sendSesEmail);

const CAMPAIGN = {
  entry_id: "camp-1",
  Name: "Launch",
  Subject: "Hello",
  Body: "Hi there",
  Segment: "seg-1",
  Status: "Draft",
};

function execSql(): string {
  return mockedExec.mock.calls.map((c) => String(c[1])).join("\n");
}

describe("campaign engine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("enqueueCampaign creates queued send rows and flips the campaign to Sending", async () => {
    mockedQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM v_campaign ")) {return [CAMPAIGN];}
      if (sql.includes("v_segment")) {return [{ filter: null }];}
      return [];
    });
    mockedMembers.mockResolvedValue({
      total: 3,
      members: [
        { entry_id: "p1", name: "Ada", email: "ada@x.co", source: "Manual", email_status: "Active", strength_score: null, last_interaction_at: null },
        { entry_id: "p2", name: "NoMail", email: null, source: "Manual", email_status: "Active", strength_score: null, last_interaction_at: null },
        { entry_id: "p3", name: "Bounced", email: "b@x.co", source: "Manual", email_status: "Hard Bounced", strength_score: null, last_interaction_at: null },
      ],
    });

    const result = await enqueueCampaign("camp-1");

    expect(result.queued).toBe(1); // only ada: no-mail and hard-bounced excluded
    const sql = execSql();
    expect(sql).toContain("campaign_send");
    expect(sql).toContain("Queued");
    expect(sql).toContain("ada@x.co");
    expect(sql).not.toContain("b@x.co");
    expect(sql).toContain("fld_status");
    expect(sql).toContain("Sending");
  });

  it("enqueueCampaign rejects non-Draft campaigns", async () => {
    mockedQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM v_campaign ")) {return [{ ...CAMPAIGN, Status: "Sending" }];}
      return [];
    });
    await expect(enqueueCampaign("camp-1")).rejects.toThrow("only Draft");
  });

  it("pause/resume are guarded by status", async () => {
    mockedQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM v_campaign ")) {return [{ ...CAMPAIGN, Status: "Sending" }];}
      return [];
    });
    await pauseCampaign("camp-1");
    expect(execSql()).toContain("Paused");

    vi.clearAllMocks();
    mockedQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM v_campaign ")) {return [{ ...CAMPAIGN, Status: "Draft" }];}
      return [];
    });
    await expect(pauseCampaign("camp-1")).rejects.toThrow("Sending");
    await expect(resumeCampaign("camp-1")).rejects.toThrow("Paused");
  });

  it("cancelCampaign cancels queued rows and the campaign", async () => {
    mockedQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM v_campaign ")) {return [{ ...CAMPAIGN, Status: "Sending" }];}
      return [];
    });
    await cancelCampaign("camp-1");
    const sql = execSql();
    expect(sql).toContain("Cancelled");
  });

  it("processCampaignQueue sends queued rows via SES and completes the campaign", async () => {
    mockedQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("field_id = 'fld_status' AND value = 'Sending'")) {return [{ entry_id: "camp-1" }];}
      if (sql.includes("FROM v_campaign ")) {return [{ ...CAMPAIGN, Status: "Sending" }];}
      if (sql.includes("FROM v_campaign_send") && sql.includes("'Queued'") && sql.includes("COUNT")) {return [{ n: 0 }];}
      if (sql.includes("FROM v_campaign_send") && sql.includes("'Sent'") && sql.includes("COUNT")) {return [{ n: 1 }];}
      if (sql.includes("FROM v_campaign_send")) {
        return [{ entry_id: "send-1", campaign_id: "camp-1", email: "ada@x.co", attempts: "0" }];
      }
      return [];
    });
    mockedSes.mockResolvedValue({ messageId: "ses-msg-1" });

    await processCampaignQueue();

    expect(mockedSes).toHaveBeenCalledWith(
      expect.objectContaining({ to: "ada@x.co", subject: "Hello" }),
    );
    const sql = execSql();
    expect(sql).toContain("ses-msg-1");
    expect(sql).toContain("fld_cs_ses");
    expect(sql).toContain("'Sent'");
    expect(sql).toContain("fld_rc"); // Recipients Count written on completion
  });

  it("processCampaignQueue marks send errors with retry metadata, Failed after max attempts", async () => {
    mockedQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("field_id = 'fld_status' AND value = 'Sending'")) {return [{ entry_id: "camp-1" }];}
      if (sql.includes("FROM v_campaign ")) {return [{ ...CAMPAIGN, Status: "Sending" }];}
      if (sql.includes("FROM v_campaign_send") && sql.includes("COUNT")) {return [{ n: 1 }];}
      if (sql.includes("FROM v_campaign_send")) {
        return [{ entry_id: "send-1", campaign_id: "camp-1", email: "ada@x.co", attempts: "2" }];
      }
      return [];
    });
    mockedSes.mockRejectedValue(new Error("Throttling"));

    await processCampaignQueue();

    const sql = execSql();
    expect(sql).toContain("'Failed'"); // attempts 2+1 = 3 = MAX → terminal
    expect(sql).toContain("Throttling");
  });

  it("handleSesNotification: permanent bounce suppresses the person", async () => {
    mockedQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("SES Message ID")) {
        return [{ entry_id: "send-1", person_id: "p1", attempts: "1" }];
      }
      return [];
    });

    const handled = await handleSesNotification({
      eventType: "Bounce",
      bounce: { bounceType: "Permanent" },
      mail: { messageId: "ses-msg-1" },
    });

    expect(handled).toBe(true);
    const sql = execSql();
    expect(sql).toContain("Hard Bounced");
    expect(sql).toContain("fld_p_emailstatus");
  });

  it("handleSesNotification: transient bounce requeues with a future attempt", async () => {
    mockedQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("SES Message ID")) {
        return [{ entry_id: "send-1", person_id: "p1", attempts: "1" }];
      }
      return [];
    });

    const handled = await handleSesNotification({
      eventType: "Bounce",
      bounce: { bounceType: "Transient" },
      mail: { messageId: "ses-msg-1" },
    });

    expect(handled).toBe(true);
    const sql = execSql();
    expect(sql).toContain("'Queued'");
    expect(sql).toContain("fld_cs_next");
  });

  it("handleSesNotification: complaint marks row and person", async () => {
    mockedQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("SES Message ID")) {
        return [{ entry_id: "send-1", person_id: "p1", attempts: "1" }];
      }
      return [];
    });

    const handled = await handleSesNotification({
      eventType: "Complaint",
      complaint: {},
      mail: { messageId: "ses-msg-1" },
    });

    expect(handled).toBe(true);
    const sql = execSql();
    expect(sql).toContain("Complained");
    expect(sql).toContain("fld_p_emailstatus");
  });

  it("handleSesNotification ignores unknown message ids", async () => {
    mockedQuery.mockResolvedValue([]);
    const handled = await handleSesNotification({
      eventType: "Bounce",
      bounce: { bounceType: "Permanent" },
      mail: { messageId: "unknown" },
    });
    expect(handled).toBe(false);
  });
});
