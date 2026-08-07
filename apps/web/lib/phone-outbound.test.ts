import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  OutboundNotConfiguredError,
  readOutboundConfig,
  triggerDial,
  triggerTelegramSend,
} from "./phone-outbound";

const fetchMock = vi.fn<typeof fetch>();

describe("phone-outbound", () => {
  beforeEach(() => {
    process.env.CRM_A_PHONE_OUTBOUND_URL = "https://provider.example/";
    process.env.CRM_A_PHONE_OUTBOUND_SECRET = "provider-secret";
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.CRM_A_PHONE_OUTBOUND_URL;
    delete process.env.CRM_A_PHONE_OUTBOUND_SECRET;
  });

  it("readOutboundConfig trims the trailing slash from baseUrl", () => {
    const config = readOutboundConfig();
    expect(config).not.toBeNull();
    expect(config!.baseUrl).toBe("https://provider.example");
    expect(config!.secret).toBe("provider-secret");
  });

  it("readOutboundConfig returns null when not configured", () => {
    delete process.env.CRM_A_PHONE_OUTBOUND_URL;
    expect(readOutboundConfig()).toBeNull();
  });

  it("triggerDial POSTs to /outbound/dial with bearer + payload and parses callId", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ accepted: true, callId: "vc-1" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await triggerDial({
      phone: "+393323000000",
      purpose: "launch-followup",
      prompt: "Contatta Lorenzo",
      conversationId: "crm-launch-001",
    });

    expect(result).toEqual({ accepted: true, callId: "vc-1" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://provider.example/outbound/dial");
    expect(init!.method).toBe("POST");
    expect((init!.headers as Record<string, string>).Authorization).toBe(
      "Bearer provider-secret",
    );
    const body = JSON.parse(String(init!.body));
    expect(body.phone).toBe("+393323000000");
    expect(body.purpose).toBe("launch-followup");
    expect(body.conversationId).toBe("crm-launch-001");
  });

  it("triggerTelegramSend POSTs to /outbound/telegram", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ accepted: true, messageId: "tg-9" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await triggerTelegramSend({
      to: { telegramUserId: "123", phone: "+393323000000" },
      text: "Ciao Lorenzo!",
      conversationId: "crm-launch-001",
    });

    expect(result).toEqual({ accepted: true, messageId: "tg-9" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://provider.example/outbound/telegram");
    const body = JSON.parse(String(init!.body));
    expect(body.text).toBe("Ciao Lorenzo!");
  });

  it("fails fast when outbound is not configured", async () => {
    delete process.env.CRM_A_PHONE_OUTBOUND_URL;
    await expect(
      triggerDial({ phone: "+393323000000" }),
    ).rejects.toBeInstanceOf(OutboundNotConfiguredError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces a non-2xx provider response as an error", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 500 }));
    await expect(
      triggerDial({ phone: "+393323000000" }),
    ).rejects.toThrow("Outbound /outbound/dial failed (500)");
  });
});
