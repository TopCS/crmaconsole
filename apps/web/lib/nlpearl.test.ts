import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildNlpearlCallbackUrls,
  getCall,
  isNlpearlConfigured,
  listPearls,
  addLead,
  setPearlActive,
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
