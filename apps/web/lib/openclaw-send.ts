/**
 * Deliver a message to a channel-bound session via the OpenClaw runtime.
 *
 * The runtime's Telegram (and other channel) senders live in the gateway
 * process; the web app reaches them over RPC. The documented send path is
 * `chat.send` with `deliver: true`, which delivers the message to the channel
 * bound to `sessionKey` (see `src/cli`/runtime plugin-sdk `deliver.d.ts`).
 *
 * Session model (matches WEBHOOK-PHONE-CONTRACT.md): one session per contact,
 * `telegram:<id>` or `phone:<e164>`. Delivering into that session routes the
 * message to the contact's Telegram chat via the runtime's sendMessageTelegram.
 */

import { callGatewayRpc } from "./agent-runner";

export type DeliverToSessionParams = {
  /** The channel-bound session key (e.g. `telegram:123456789`). */
  sessionKey: string;
  /** Message text to deliver. */
  message: string;
  /** Optional, for safe provider retries. */
  idempotencyKey?: string;
};

export type DeliverToSessionResult = {
  ok: boolean;
  payload: unknown;
  error?: string;
};

/**
 * Deliver `message` into the channel bound to `sessionKey` over the gateway.
 * The session is created on demand by the runtime if missing. Throws when the
 * gateway RPC fails at the transport level; returns `{ ok:false, error }` when
 * the runtime rejects delivery (so callers can surface it per-recipient).
 */
export async function deliverToSession(
  params: DeliverToSessionParams,
): Promise<DeliverToSessionResult> {
  if (!params.sessionKey.trim() || !params.message.trim()) {
    return { ok: false, error: "sessionKey and message are required", payload: null };
  }
  const res = await callGatewayRpc("chat.send", {
    sessionKey: params.sessionKey,
    message: params.message,
    deliver: true,
    ...(params.idempotencyKey ? { idempotencyKey: params.idempotencyKey } : {}),
  });
  if (!res.ok) {
    return {
      ok: false,
      error: typeof res.error === "string" ? res.error : "Runtime rejected delivery",
      payload: res.payload ?? null,
    };
  }
  return { ok: true, payload: res.payload ?? null };
}
