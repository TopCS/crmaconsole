import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildNlpearlCallbackUrls,
  getCall,
  isNlpearlConfigured,
  listPearls,
  listVoices,
  addLead,
  setPearlActive,
  resolvePhoneIdFromNumber,
  resolvePearlIdByName,
  OUTBOUND_PHONE_DIRECTIONS,
  INBOUND_PHONE_DIRECTIONS,
} from "./nlpearl";

const fetchMock = vi.fn<typeof fetch>();

/** Extract the last fetch call's URL string + body, typed concretely. */
function lastCall(): { url: string; init: RequestInit | undefined } {
  const call = fetchMock.mock.calls.at(-1);
  const requestInfo = call?.[0];
  const url =
    requestInfo instanceof URL
      ? requestInfo.toString()
      : typeof requestInfo === "string"
        ? requestInfo
        : "";
  return { url, init: call?.[1] };
}

describe("resolvePhoneIdFromNumber", () => {
  // Direction mapping per Get Phone Numbers docs:
  // 1 = InboundOutbound, 2 = Inbound, 3 = Outbound, 10 = NotSet.
  const phones = [
    { id: "both-a", number: "+39654547159", direction: 1 },
    { id: "inbound-only", number: "+390654547620", direction: 2 },
    { id: "outbound-only", number: "+390654547621", direction: 3 },
    { id: "unclassified", number: "+393331112222", direction: 10 },
  ];

  function stubPhones() {
    // A fresh Response per call: a shared one has its body consumed on the first read.
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify(phones), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
  }

  beforeEach(() => {
    process.env.NLPEARL_ACCOUNT_ID = "ACC123";
    process.env.NLPEARL_SECRET_KEY = "KEY456";
    delete process.env.NLPEARL_BASE_URL;
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    stubPhones();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.NLPEARL_ACCOUNT_ID;
    delete process.env.NLPEARL_SECRET_KEY;
  });

  it("resolves a dialed number to the Phone ID for the requested direction", async () => {
    expect(await resolvePhoneIdFromNumber("390654547620", { directions: INBOUND_PHONE_DIRECTIONS }))
      .toBe("inbound-only");
    expect(await resolvePhoneIdFromNumber("+390654547621", { directions: OUTBOUND_PHONE_DIRECTIONS }))
      .toBe("outbound-only");
  });

  it("never hands an outbound-only line to an inbound agent", async () => {
    expect(await resolvePhoneIdFromNumber("+390654547621", { directions: INBOUND_PHONE_DIRECTIONS }))
      .toBeNull();
    expect(await resolvePhoneIdFromNumber("+390654547621", { directions: OUTBOUND_PHONE_DIRECTIONS }))
      .toBe("outbound-only");
    expect(await resolvePhoneIdFromNumber("+39654547159", { directions: INBOUND_PHONE_DIRECTIONS }))
      .toBe("both-a");
    expect(await resolvePhoneIdFromNumber("+39654547159", { directions: OUTBOUND_PHONE_DIRECTIONS }))
      .toBe("both-a");
  });

  it("ignores unclassified lines and numbers too short to be a phone number", async () => {
    expect(await resolvePhoneIdFromNumber("3331112222", { directions: OUTBOUND_PHONE_DIRECTIONS }))
      .toBeNull();
    expect(await resolvePhoneIdFromNumber("1234567", { directions: OUTBOUND_PHONE_DIRECTIONS }))
      .toBeNull();
  });
});

describe("nlpearl client", () => {
  beforeEach(() => {
    process.env.NLPEARL_ACCOUNT_ID = "ACC123";
    process.env.NLPEARL_SECRET_KEY = "KEY456";
    delete process.env.NLPEARL_BASE_URL;
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.NLPEARL_ACCOUNT_ID;
    delete process.env.NLPEARL_SECRET_KEY;
    delete process.env.NLPEARL_BASE_URL;
  });

  it("isNlpearlConfigured reflects the env", () => {
    expect(isNlpearlConfigured()).toBe(true);
    delete process.env.NLPEARL_SECRET_KEY;
    expect(isNlpearlConfigured()).toBe(false);
  });

  it("sends Bearer AccountId:SecretKey and hits the v2 base", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify([{ id: "p1", name: "Campagna", type: 2 }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const pearls = await listPearls();
    expect(pearls[0].id).toBe("p1");
    const { url, init } = lastCall();
    expect(url).toBe("https://api.nlpearl.ai/v2/Pearl");
    expect((init!.headers as Record<string, string>).Authorization).toBe("Bearer ACC123:KEY456");
  });

  it("addLead POSTs lead data with externalId + callData to the pearl path", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ id: "lead-9" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const result = await addLead({
      pearlId: "pearl-x",
      phoneNumber: "+393331234567",
      externalId: "campaign_send_1",
      callData: { firstName: "Lorenzo", plan: "Premium" },
    });
    expect(result.id).toBe("lead-9");
    const { url, init } = lastCall();
    expect(url).toBe("https://api.nlpearl.ai/v2/Outbound/pearl-x/Lead");
    const body = JSON.parse(init!.body as string);
    expect(body.phoneNumber).toBe("+393331234567");
    expect(body.externalId).toBe("campaign_send_1");
    expect(body.callData.firstName).toBe("Lorenzo");
  });

  it("getCall GETs /Call/:id", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ id: "c1", conversationStatus: "Success" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const call = await getCall("c1");
    expect(call.id).toBe("c1");
    expect(lastCall().url).toBe("https://api.nlpearl.ai/v2/Call/c1");
  });

  it("setPearlActive PUTs isActive", async () => {
    fetchMock.mockResolvedValue(
      new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    await setPearlActive("pearl-x", true);
    const { url, init } = lastCall();
    expect(url).toBe("https://api.nlpearl.ai/v2/Pearl/pearl-x/Active");
    expect(JSON.parse(init!.body as string).isActive).toBe(true);
  });

  it("surfaces non-2xx as an error", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 401 }));
    await expect(listPearls()).rejects.toThrow("NLPearl GET /Pearl failed (401)");
  });
});

describe("buildNlpearlCallbackUrls", () => {
  it("builds call + lead webhook URLs from the origin, trimming trailing slash", () => {
    const urls = buildNlpearlCallbackUrls("https://crm-a-console.example.net/");
    expect(urls.callWebhookUrl).toBe("https://crm-a-console.example.net/api/nlpearl/webhook/call");
    expect(urls.leadWebhookUrl).toBe("https://crm-a-console.example.net/api/nlpearl/webhook/lead");
  });

  it("appends a verify token query param when provided", () => {
    const urls = buildNlpearlCallbackUrls("https://crm.example.net", "my-secret");
    expect(urls.callWebhookUrl).toContain("?token=my-secret");
    expect(urls.leadWebhookUrl).toContain("?token=my-secret");
  });
});

describe("listVoices (grouped shape)", () => {
  beforeEach(() => {
    process.env.NLPEARL_ACCOUNT_ID = "ACC123";
    process.env.NLPEARL_SECRET_KEY = "KEY456";
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    delete process.env.NLPEARL_ACCOUNT_ID;
    delete process.env.NLPEARL_SECRET_KEY;
    vi.unstubAllGlobals();
  });
  it("flattens per-language groups and tags into voice entries", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify([
        { language: "Italian", voices: [{ id: "v1", name: "Tommaso", tags: ["IT"] }, { id: "v2", name: "Federica", tags: ["IT"] }] },
        { language: "English", voices: [{ id: "v3", name: "John", tags: ["EN"] }] },
      ]), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    const voices = await listVoices();
    expect(voices).toHaveLength(3);
    expect(voices[0]).toEqual({ id: "v1", name: "Tommaso", language: "Italian", tags: ["IT"] });
    expect(voices[2].language).toBe("English");
  });
});

describe("resolvePearlIdByName", () => {
  const pearls = [
    { id: "pearl-inbound-1", name: "Customer Care", type: 1 },
    { id: "pearl-outbound-1", name: "Campagna Galaxy S27", type: 2 },
    { id: "pearl-outbound-2", name: "Lancio Accessori", type: 2 },
  ];

  function stubPearls() {
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify(pearls), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
  }

  beforeEach(() => {
    process.env.NLPEARL_ACCOUNT_ID = "ACC123";
    process.env.NLPEARL_SECRET_KEY = "KEY456";
    delete process.env.NLPEARL_BASE_URL;
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    delete process.env.NLPEARL_ACCOUNT_ID;
    delete process.env.NLPEARL_SECRET_KEY;
    vi.unstubAllGlobals();
  });

  it("resolves by exact name, case-insensitive", async () => {
    stubPearls();
    expect(await resolvePearlIdByName("campagna galaxy s27")).toBe("pearl-outbound-1");
    expect(await resolvePearlIdByName("Customer Care")).toBe("pearl-inbound-1");
  });

  it("filters by kind so an outbound request never picks an inbound Pearl", async () => {
    stubPearls();
    expect(await resolvePearlIdByName("Lancio Accessori", { kind: "outbound" })).toBe("pearl-outbound-2");
    await expect(resolvePearlIdByName("Customer Care", { kind: "outbound" }))
      .rejects.toThrow(/no outbound.*customer care/i);
  });

  it("throws with the list of usable pearls when nothing matches", async () => {
    stubPearls();
    await expect(resolvePearlIdByName("Ghost", { kind: "inbound" })).rejects.toThrow(/available inbound pearls.*customer care/i);
  });
});
