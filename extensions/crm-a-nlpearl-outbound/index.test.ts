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
    on: vi.fn(),
    runtime: {
      channel: { telegram: { sendMessageTelegram: vi.fn(async () => ({ messageId: "tg-0" })) } },
    },
    logger: { info: vi.fn() },
  } as any;
}

function getHookHandler(api: { on: ReturnType<typeof vi.fn> }, hookName: string) {
  const call = api.on.mock.calls.find((c) => c[0] === hookName);
  return call ? call[1] : undefined;
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
    expect(getRegisteredTool(api, "crm_a_multichannel")).toBeTruthy();
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

  it("activate forwards pearlName to reuse an existing Pearl by name", async () => {
    process.env.CRM_A_PHONE_WEBHOOK_SECRET = "test-secret";
    let seenBody: Record<string, unknown> = {};
    globalThis.fetch = vi.fn(async (_input, init) => {
      seenBody = JSON.parse(String(init?.body ?? "{}"));
      return new Response(JSON.stringify({ ok: true, pearlId: "pearl-existing", active: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const api = makeApi();
    register(api);
    const tool = getRegisteredTool(api, "crm_a_inbound_care");
    const result = await executeTool(tool, { action: "activate", pearlName: "Customer Care", confirm: true });
    expect(seenBody).toEqual({ action: "activate", pearlName: "Customer Care" });
    expect(result.details.active).toBe(true);
  });

  it("does not register tools when the secret is missing", () => {
    const api = makeApi();
    register(api);
    expect(getRegisteredTool(api, "crm_a_inbound_care")).toBeUndefined();
  });
});

describe("crm_a_multichannel tool", () => {
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

  function getTool() {
    process.env.CRM_A_PHONE_WEBHOOK_SECRET = "test-secret";
    const api = makeApi();
    register(api);
    return getRegisteredTool(api, "crm_a_multichannel");
  }

  it("registers when the secret is set", () => {
    expect(getTool()).toBeTruthy();
  });

  it("requires segmentEntryId or segmentName", async () => {
    const tool = getTool();
    const result = await executeTool(tool, { body: "Hello" });
    expect(result.details.error).toContain("segmentEntryId or segmentName");
  });

  it("requires body", async () => {
    const tool = getTool();
    const result = await executeTool(tool, { segmentName: "Lancio Samsung Galaxy" });
    expect(result.details.error).toContain("body is required");
  });

  it("refuses a real send without confirm:true", async () => {
    const tool = getTool();
    const result = await executeTool(tool, {
      segmentName: "Lancio Samsung Galaxy",
      body: "Hello",
      preview: false,
    });
    expect(result.details.needsConfirmation).toBe(true);
  });

  it("preview:true dry-runs without confirm and forwards to the route", async () => {
    let seenUrl = "";
    let seenBody: Record<string, unknown> = {};
    globalThis.fetch = vi.fn(async (input, init) => {
      seenUrl = typeof input === "string" ? input : String(input);
      seenBody = JSON.parse(String(init?.body ?? "{}"));
      return new Response(
        JSON.stringify({ ok: true, preview: true, telegram: 3, email: 7 }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    const tool = getTool();
    const result = await executeTool(tool, {
      segmentName: "Lancio Samsung Galaxy",
      subject: "Offerta",
      body: "Ciao!",
      preview: true,
    });

    expect(seenUrl).toContain("/api/campaigns/send-multichannel");
    expect(seenBody).toEqual({
      segmentName: "Lancio Samsung Galaxy",
      subject: "Offerta",
      body: "Ciao!",
      preview: true,
    });
    expect(result.details.preview).toBe(true);
    expect(result.details.telegram).toBe(3);
  });

  it("prefers segmentEntryId over segmentName and sends for real with confirm:true", async () => {
    let seenBody: Record<string, unknown> = {};
    globalThis.fetch = vi.fn(async (_input, init) => {
      seenBody = JSON.parse(String(init?.body ?? "{}"));
      return new Response(JSON.stringify({ ok: true, sent: 42 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const tool = getTool();
    const result = await executeTool(tool, {
      segmentEntryId: "seg-123",
      segmentName: "Ignored Segment",
      body: "Ciao!",
      confirm: true,
    });

    expect(seenBody).toEqual({
      segmentEntryId: "seg-123",
      subject: "",
      body: "Ciao!",
      preview: false,
    });
    expect(result.details.sent).toBe(42);
  });

  it("surfaces route errors", async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response(JSON.stringify({ error: "Segment \"Nope\" not found." }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const tool = getTool();
    const result = await executeTool(tool, {
      segmentName: "Nope",
      body: "Ciao!",
      confirm: true,
    });
    expect(result.details.error).toContain("Segment \"Nope\" not found.");
  });
});

describe("crm_a_telegram_person tool", () => {
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

  function getTool() {
    process.env.CRM_A_PHONE_WEBHOOK_SECRET = "test-secret";
    const api = makeApi();
    register(api);
    return getRegisteredTool(api, "crm_a_telegram_person");
  }

  it("registers when the secret is set", () => {
    expect(getTool()).toBeTruthy();
  });

  it("requires personEntryId or personName", async () => {
    const tool = getTool();
    const result = await executeTool(tool, { body: "Ciao" });
    expect(result.details.error).toContain("personEntryId or personName");
  });

  it("refuses a real send without confirm:true", async () => {
    const tool = getTool();
    const result = await executeTool(tool, {
      personName: "Lorenzo Lorato",
      body: "Ciao!",
      preview: false,
    });
    expect(result.details.needsConfirmation).toBe(true);
  });

  it("preview:true dry-runs and forwards to the route", async () => {
    let seenUrl = "";
    let seenBody: Record<string, unknown> = {};
    globalThis.fetch = vi.fn(async (input, init) => {
      seenUrl = typeof input === "string" ? input : String(input);
      seenBody = JSON.parse(String(init?.body ?? "{}"));
      return new Response(
        JSON.stringify({ ok: true, preview: true, target: "telegram:987654321" }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    const tool = getTool();
    const result = await executeTool(tool, {
      personName: "Lorenzo Lorato",
      subject: "Offerta",
      body: "Ciao!",
      preview: true,
    });

    expect(seenUrl).toContain("/api/campaigns/telegram-person");
    expect(seenBody).toEqual({
      personName: "Lorenzo Lorato",
      subject: "Offerta",
      body: "Ciao!",
      preview: true,
    });
    expect(result.details.target).toBe("telegram:987654321");
  });

  it("sends for real with confirm:true using personEntryId", async () => {
    let seenBody: Record<string, unknown> = {};
    globalThis.fetch = vi.fn(async (_input, init) => {
      seenBody = JSON.parse(String(init?.body ?? "{}"));
      return new Response(JSON.stringify({ ok: true, delivered: true, target: "telegram:1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const tool = getTool();
    const result = await executeTool(tool, {
      personEntryId: "person-1",
      body: "Ciao!",
      confirm: true,
    });

    expect(seenBody).toEqual({
      personEntryId: "person-1",
      subject: "",
      body: "Ciao!",
      preview: false,
    });
    expect(result.details.delivered).toBe(true);
  });
});

describe("inbound telegram bridge (message_received)", () => {
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

  function setup() {
    process.env.CRM_A_PHONE_WEBHOOK_SECRET = "test-secret";
    const api = makeApi();
    register(api);
    return api;
  }

  it("forwards a telegram message to the webhook and replies with the CRM context", async () => {
    let seenUrl = "";
    let seenBody: Record<string, unknown> = {};
    globalThis.fetch = vi.fn(async (input, init) => {
      seenUrl = typeof input === "string" ? input : String(input);
      seenBody = JSON.parse(String(init?.body ?? "{}"));
      return new Response(
        JSON.stringify({
          context: "Cliente esistente: Lorenzo Lorato… corriere GLS…",
          person: { id: "person-1", name: "Lorenzo Lorato" },
          matched: "existing",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    const api = setup();
    const handler = getHookHandler(api, "message_received");
    expect(handler).toBeTruthy();
    await handler(
      {
        from: "987654321",
        content: "Ciao, com'è la consegna?",
        metadata: { senderId: "987654321", senderName: "Lorenzo Lorato", senderE164: "+393312345678", messageId: "tg-1" },
      },
      { channelId: "telegram", conversationId: "c-1" },
    );

    expect(seenUrl).toContain("/api/webhooks/phone");
    expect(seenBody.action).toBe("message");
    expect(seenBody.text).toBe("Ciao, com'è la consegna?");
    expect(seenBody.messageId).toBe("tg-1");
    expect(seenBody.contact).toEqual({
      telegramUserId: "987654321",
      name: "Lorenzo Lorato",
      phone: "+393312345678",
    });
    const send = api.runtime.channel.telegram.sendMessageTelegram;
    expect(send).toHaveBeenCalledWith(
      "987654321",
      "Cliente esistente: Lorenzo Lorato… corriere GLS…",
    );
  });

  it("ignores non-telegram channels", async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const api = setup();
    const handler = getHookHandler(api, "message_received");
    await handler(
      { from: "x", content: "hi", metadata: {} },
      { channelId: "whatsapp" },
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("does not reply when the webhook rejects the message", async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response(JSON.stringify({ error: "boom" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    const api = setup();
    const handler = getHookHandler(api, "message_received");
    await handler(
      { from: "987654321", content: "Ciao", metadata: { senderId: "987654321" } },
      { channelId: "telegram" },
    );
    expect(api.runtime.channel.telegram.sendMessageTelegram).not.toHaveBeenCalled();
  });
});

describe("crm_a_phone_campaign upsert pearl reuse", () => {
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

  function setup() {
    process.env.CRM_A_PHONE_WEBHOOK_SECRET = "test-secret";
    const api = makeApi();
    register(api);
    return api;
  }

  it("upsert forwards pearlName to reuse an existing outbound Pearl", async () => {
    let seenBody: Record<string, unknown> = {};
    globalThis.fetch = vi.fn(async (_input, init) => {
      seenBody = JSON.parse(String(init?.body ?? "{}"));
      return new Response(JSON.stringify({ ok: true, campaignId: "C-1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const api = setup();
    const tool = getRegisteredTool(api, "crm_a_phone_campaign");
    const result = await executeTool(tool, {
      action: "upsert",
      name: "Lancio Galaxy S27",
      pearlName: "Campagna Galaxy S27",
      confirm: true,
    });
    expect(seenBody.pearlName).toBe("Campagna Galaxy S27");
    expect(seenBody.name).toBe("Lancio Galaxy S27");
    expect(result.details.campaignId).toBe("C-1");
  });
});
