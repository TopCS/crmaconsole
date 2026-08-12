import { beforeEach, describe, expect, it, vi } from "vitest";

const execMock = vi.fn().mockResolvedValue(undefined);
const pathMock = vi.fn().mockResolvedValue("/tmp/workspace.duckdb");
const queryMock = vi.fn().mockResolvedValue([]);
const listMembersMock = vi.fn();
const createVoicePearlMock = vi.fn().mockResolvedValue("pearl-1");
const resolveVoiceIdMock = vi.fn().mockResolvedValue("voice-1");

vi.mock("./workspace", () => ({
  duckdbExecOnFileAsync: (...a: unknown[]) => execMock(...a),
  duckdbPathAsync: (...a: unknown[]) => pathMock(...a),
  duckdbQueryAsync: (...a: unknown[]) => queryMock(...a),
}));

const fieldMapsMock = vi.fn();
vi.mock("./crm-queries", () => ({
  loadCrmFieldMaps: () => fieldMapsMock(),
  sqlString: (v: string) => `'${String(v).replace(/'/g, "''")}'`,
}));

vi.mock("./segments", () => ({
  listSegmentMembers: (...a: unknown[]) => listMembersMock(...a),
  buildSegmentWhereSql: vi.fn(),
}));

vi.mock("./nlpearl", () => ({
  isNlpearlConfigured: () => true,
  createVoicePearl: (...a: unknown[]) => createVoicePearlMock(...a),
  resolveVoiceId: (...a: unknown[]) => resolveVoiceIdMock(...a),
  addLead: vi.fn(),
  setPearlActive: vi.fn(),
  buildNlpearlCallbackUrls: () => ({
    callWebhookUrl: "https://x/api/nlpearl/webhook/call",
    leadWebhookUrl: "https://x/api/nlpearl/webhook/lead",
  }),
}));

vi.mock("./phone-webhook", () => ({
  readPhoneWebhookSecret: () => "secret",
}));

import {
  createPhonePearlForCampaign,
  loadCampaignPhoneConfig,
  resolveAudienceForCampaign,
  upsertPhoneCampaign,
} from "./campaign-phone";

function campaignMap(overrides: Record<string, string> = {}) {
  return {
    campaign: {
      Name: "fld_campaign_name",
      "Nlpearl Pearl ID": "fld_pearl_id",
      "Nlpearl Phone ID": "fld_phone_id",
      "Calling Window Start": "fld_win_start",
      "Calling Window End": "fld_win_end",
      "Calling Timezone": "fld_tz",
      "Calling Days": "fld_days",
      "Max Attempts": "fld_attempts",
      "Nlpearl Retry Rate": "fld_retry",
      "Nlpearl Agent Count": "fld_agents",
      "Voice Brief": "fld_voice_brief",
      "Segment": "fld_segment",
      ...overrides,
    },
    campaign_send: {},
    people: {
      "Phone Number": "fld_phone",
      "Full Name": "fld_name",
      "Email Address": "fld_email",
      "Marketing Opt-in": "fld_optin",
      "Preferred Contact Channel": "fld_pref",
    },
  };
}

describe("upsertPhoneCampaign", () => {
  beforeEach(() => {
    execMock.mockClear();
    pathMock.mockClear();
    queryMock.mockClear();
    fieldMapsMock.mockResolvedValue(campaignMap());
  });

  it("creates a campaign card and writes phone config + Voice Brief", async () => {
    const id = await upsertPhoneCampaign({
      name: "Demo",
      phoneId: "686fd112a91849a9e59a5353",
      brief: "Ciao prodotto",
    });
    expect(id).toBeTruthy();
    expect(execMock).toHaveBeenCalledTimes(1);
    const sql = execMock.mock.calls[0][1] as string;
    expect(sql).toContain("INSERT OR IGNORE INTO entries");
    expect(sql).toContain("fld_campaign_name");
    expect(sql).toContain("Demo");
    expect(sql).toContain("fld_voice_brief");
    expect(sql).toContain("Ciao prodotto");
  });

  it("reuses a provided campaignId", async () => {
    const id = await upsertPhoneCampaign({ campaignId: "C-1", phoneId: "p" });
    expect(id).toBe("C-1");
    expect(execMock.mock.calls[0][1]).toContain("'C-1'");
  });
});

describe("loadCampaignPhoneConfig", () => {
  beforeEach(() => {
    queryMock.mockClear();
    fieldMapsMock.mockResolvedValue(campaignMap());
  });

  it("reads the Voice Brief field", async () => {
    queryMock.mockResolvedValue([{ id: "C-1", brief: "Ciao" } as Record<string, string | null>]);
    const cfg = await loadCampaignPhoneConfig("C-1");
    expect(cfg?.brief).toBe("Ciao");
  });

  it("returns null when the campaign is missing", async () => {
    queryMock.mockResolvedValue([]);
    expect(await loadCampaignPhoneConfig("nope")).toBeNull();
  });
});

describe("resolveAudienceForCampaign", () => {
  beforeEach(() => {
    queryMock.mockReset();
    listMembersMock.mockReset();
    fieldMapsMock.mockResolvedValue(campaignMap());
  });

  it("returns phone-compliant people capped by count", async () => {
    queryMock
      .mockResolvedValueOnce([{ segment: null }]) // resolveCampaignSegmentId (no campaign segment)
      .mockResolvedValueOnce([
        { entry_id: "P1", name: "A", email: "a@x", phone: "+1" },
        { entry_id: "P2", name: "B", email: "b@x", phone: "+2" },
      ]) // base query — la mock simula il risultato del LIMIT in SQL
      .mockResolvedValue([]);
    const rows = await resolveAudienceForCampaign("C-1", { count: 2 });
    expect(rows.map((r) => r.entry_id)).toEqual(["P1", "P2"]);
    // il cap è spinto nel SQL (fix concern C3): la query base porta LIMIT 2
    const baseSql = queryMock.mock.calls[1][0] as string;
    expect(baseSql).toContain("LIMIT 2");
  });

  it("scopes to a segment's members when segmentId is provided", async () => {
    queryMock
      .mockResolvedValueOnce([
        { entry_id: "P1", name: "A", email: "a@x", phone: "+1" },
        { entry_id: "P2", name: "B", email: "b@x", phone: "+2" },
      ])
      .mockResolvedValueOnce([{ filter: "{}" }]);
    listMembersMock.mockResolvedValue({
      total: 1,
      members: [
        {
          entry_id: "P1",
          name: "A",
          email: "a@x",
          source: "CRM",
          email_status: "Valid",
          strength_score: null,
          last_interaction_at: null,
        },
      ],
    });
    const rows = await resolveAudienceForCampaign("C-1", { segmentId: "S-1" });
    expect(rows.map((r) => r.entry_id)).toEqual(["P1"]);
  });
});

describe("createPhonePearlForCampaign", () => {
  beforeEach(() => {
    queryMock.mockReset();
    createVoicePearlMock.mockClear();
    resolveVoiceIdMock.mockClear();
    fieldMapsMock.mockResolvedValue(campaignMap());
  });

  it("defaults the voice brief to the campaign's Voice Brief", async () => {
    queryMock.mockResolvedValue([
      {
        pearlId: null,
        phoneId: "686fd112a91849a9e59a5353",
        brief: "Ciao prodotto",
        windowStart: null,
        windowEnd: null,
        timezone: null,
        daysRaw: null,
        maxAttempts: null,
        retryRate: null,
        agentCount: null,
      } as Record<string, string | null>,
    ]);
    const pearlId = await createPhonePearlForCampaign("C-1", "https://origin");
    expect(pearlId).toBe("pearl-1");
    expect(createVoicePearlMock).toHaveBeenCalledTimes(1);
    const payload = createVoicePearlMock.mock.calls[0][0] as {
      pearl?: { nodes?: Array<{ nodeId: string; instructions?: string }> };
    };
    const speak = payload.pearl?.nodes?.find((n) => n.nodeId === "speak");
    expect(speak?.instructions).toContain("Ciao prodotto");
  });
});
