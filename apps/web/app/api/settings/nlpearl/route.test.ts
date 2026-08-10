import { beforeEach, describe, expect, it, vi } from "vitest";

const state = new Map<string, string>();
vi.mock("node:fs", () => ({
  existsSync: (p: string) => state.has(p),
  readFileSync: (p: string) => {
    if (!state.has(p)) {throw new Error("ENOENT");}
    return state.get(p)!;
  },
  writeFileSync: (p: string, c: string) => { state.set(p, c); },
  mkdirSync: () => {},
}));
vi.mock("@/lib/workspace", () => ({
  resolveOpenClawStateDir: () => "/tmp/nlpearl-route",
}));
vi.mock("@/lib/public-origin", () => ({
  resolveAppPublicOrigin: () => "https://crm.example.net",
}));
vi.mock("@/lib/phone-webhook", () => ({
  readPhoneWebhookSecret: () => "sec",
}));

const { GET, POST, DELETE } = await import("./route");

const PATH = "/tmp/nlpearl-route/.crm-a-nlpearl.json";

function req(body: unknown, method = "POST"): Request {
  return new Request("http://localhost/api/settings/nlpearl", {
    method,
    headers: { "Content-Type": "application/json" },
    body: method === "GET" || method === "DELETE" ? undefined : JSON.stringify(body),
  });
}

describe("/api/settings/nlpearl", () => {
  beforeEach(() => {
    state.clear();
    delete process.env.NLPEARL_ACCOUNT_ID;
    delete process.env.NLPEARL_SECRET_KEY;
    delete process.env.NLPEARL_BASE_URL;
  });

  it("GET reports not configured with callback URLs", async () => {
    const data = await (await GET(req({}, "GET"))).json();
    expect(data.configured).toBe(false);
    expect(data.callWebhookUrl).toContain("/api/nlpearl/webhook/call");
    expect(data.callWebhookUrl).toContain("token=sec");
  });

  it("POST validates + persists; GET reads it back masked", async () => {
    const save = await POST(req({ accountId: "A", secretKey: "K", baseUrl: "https://api.x/v2" }));
    expect(save.status).toBe(200);
    const data = await (await GET(req({}, "GET"))).json();
    expect(data.configured).toBe(true);
    expect(data.source).toBe("config");
    expect(data.accountId).toBe("A");
    expect(data.secretKeyMasked).toContain("••••");
    expect(data.baseUrl).toBe("https://api.x/v2");
  });

  it("POST rejects missing fields", async () => {
    const res = await POST(req({ accountId: "A" }));
    expect(res.status).toBe(400);
  });

  it("env wins over config file in GET", async () => {
    state.set(PATH, JSON.stringify({ accountId: "CFG-A", secretKey: "CFG-K" }));
    process.env.NLPEARL_ACCOUNT_ID = "ENV-A";
    process.env.NLPEARL_SECRET_KEY = "ENV-K";
    const data = await (await GET(req({}, "GET"))).json();
    expect(data.source).toBe("env");
    expect(data.accountId).toBe("ENV-A");
  });

  it("DELETE clears config", async () => {
    state.set(PATH, JSON.stringify({ accountId: "A", secretKey: "K" }));
    await DELETE();
    expect(state.get(PATH)).toBe("");
  });
});