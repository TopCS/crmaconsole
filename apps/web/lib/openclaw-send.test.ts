import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/agent-runner", () => ({
  callGatewayRpc: vi.fn(),
}));

const { deliverToSession } = await import("./openclaw-send");
const { callGatewayRpc } = await import("@/lib/agent-runner");
const mockedRpc = vi.mocked(callGatewayRpc);

describe("deliverToSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls chat.send with deliver:true and the session key", async () => {
    mockedRpc.mockResolvedValue({ ok: true, payload: { messageId: "tg-1" } } as never);

    const result = await deliverToSession({
      sessionKey: "telegram:123456789",
      message: "Ciao Lorenzo!",
      idempotencyKey: "campaign-1-lorenzo",
    });

    expect(result.ok).toBe(true);
    expect(mockedRpc).toHaveBeenCalledWith("chat.send", {
      sessionKey: "telegram:123456789",
      message: "Ciao Lorenzo!",
      deliver: true,
      idempotencyKey: "campaign-1-lorenzo",
    });
  });

  it("surfaces a runtime rejection as ok:false with the error", async () => {
    mockedRpc.mockResolvedValue({ ok: false, error: "channel not connected" } as never);

    const result = await deliverToSession({
      sessionKey: "telegram:123456789",
      message: "Ciao",
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("channel not connected");
    expect(mockedRpc).toHaveBeenCalledTimes(1);
  });

  it("rejects empty sessionKey/message without calling the gateway", async () => {
    const result = await deliverToSession({ sessionKey: " ", message: "" });
    expect(result.ok).toBe(false);
    expect(mockedRpc).not.toHaveBeenCalled();
  });
});
