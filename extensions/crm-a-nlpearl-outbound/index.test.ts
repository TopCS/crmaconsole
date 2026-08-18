import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import register from "./index.ts";

function getRegisteredTool(api: { registerTool: ReturnType<typeof vi.fn> }, name: string) {
  return api.registerTool.mock.calls.map((call) => call[0]).find((tool) => tool?.name === name);
}

async function executeTool(
  tool: { execute: (toolCallId: string, input: Record<string, unknown>) => Promise<any> },
  input: Record<string, unknown>,
) {
  return await tool.execute("tool-call-1", input);
}

function mockFetch(responseBody: unknown, status = 200) {
  globalThis.fetch = vi.fn(async () => {
    return new Response(JSON.stringify(responseBody), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

function makeApi() {
  return {
    config: { plugins: { entries: {} } },
    registerTool: vi.fn(),
    logger: { info: vi.fn() },
  } as any;
}

describe("crm_a_inbound_care tool", () => {
  const originalFetch = globalThis.fetch;
  const originalSecret = process.env.CRM_A_PHONE_WEBHOOK_SECRET;

  beforeEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env.CRM_A_PHONE_WEBHOOK_SECRET;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalSecret !== undefined) {
      process.env.CRM_A_PHONE_WEBHOOK_SECRET = originalSecret;
    } else {
      delete process.env.CRM_A_PHONE_WEBHOOK_SECRET;
    }
  });

  it("registers both phone tools when the secret is set", () => {
    process.env.CRM_A_PHONE_WEBHOOK_SECRET = "test-secret";
    const api = makeApi();
    register(api);
    expect(getRegisteredTool(api, "crm_a_phone_campaign")).toBeTruthy();
    expect(getRegisteredTool(api, "crm_a_inbound_care")).toBeTruthy();
  });

  it("refuses activate without confirm:true", async () => {
    process.env.CRM_A_PHONE_WEBHOOK_SECRET = "test-secret";
    const api = makeApi();
    register(api);
    const tool = getRegisteredTool(api, "crm_a_inbound_care");
    const result = await executeTool(tool, { action: "activate", pearlId: "pearl-1" });
    expect(result.details.needsConfirmation).toBe(true);
  });

  it("create forwards name/phoneId/brief to /api/nlpearl/inbound", async () => {
    process.env.CRM_A_PHONE_WEBHOOK_SECRET = "test-secret";
    let seenUrl = "";
    let seenBody: Record<string, unknown> = {};
    globalThis.fetch = vi.fn(async (input, init) => {
      seenUrl = typeof input === "string" ? input : String(input);
      seenBody = JSON.parse(String(init?.body ?? "{}"));
      return new Response(JSON.stringify({ ok: true, pearlId: "pearl-2" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const api = makeApi();
    register(api);
    const tool = getRegisteredTool(api, "crm_a_inbound_care");
    const result = await executeTool(tool, {
      action: "create",
      name: "Care",
      phoneId: "pn-1",
      brief: "## Offerta",
    });

    expect(seenUrl).toContain("/api/nlpearl/inbound");
    expect(seenBody).toEqual({ action: "create", name: "Care", phoneId: "pn-1", brief: "## Offerta" });
    expect(result.details.pearlId).toBe("pearl-2");
  });

  it("activate requires pearlId and forwards it", async () => {
    process.env.CRM_A_PHONE_WEBHOOK_SECRET = "test-secret";
    let seenBody: Record<string, unknown> = {};
    globalThis.fetch = vi.fn(async (_input, init) => {
      seenBody = JSON.parse(String(init?.body ?? "{}"));
      return new Response(JSON.stringify({ ok: true, pearlId: "pearl-3", active: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const api = makeApi();
    register(api);
    const tool = getRegisteredTool(api, "crm_a_inbound_care");
    const result = await executeTool(tool, { action: "activate", pearlId: "pearl-3", confirm: true });
    expect(seenBody).toEqual({ action: "activate", pearlId: "pearl-3" });
    expect(result.details.active).toBe(true);
  });

  it("does not register tools when the secret is missing", () => {
    const api = makeApi();
    register(api);
    expect(getRegisteredTool(api, "crm_a_inbound_care")).toBeUndefined();
  });
});
