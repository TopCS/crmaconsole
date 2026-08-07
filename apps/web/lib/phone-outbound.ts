/**
 * Outbound client (harness → phone provider).
 *
 * The provider owns dialing and Telegram sending; this console triggers them
 * by calling the provider's outbound endpoints. Base URL and bearer secret are
 * configured per deployment via env; when unset the client is inert and every
 * call fails fast with a clear error (safe default, nothing is sent).
 *
 * Contract (mirrors WEBHOOK-PHONE-CONTRACT.md §5):
 *   POST <base>/outbound/dial      → { accepted, callId }
 *   POST <base>/outbound/telegram  → { accepted, messageId }
 */

export type DialRequest = {
  phone: string;
  purpose?: string;
  prompt?: string;
  context?: Record<string, unknown>;
  conversationId?: string;
};

export type TelegramSendRequest = {
  to: { telegramUserId?: string; phone?: string };
  text: string;
  context?: Record<string, unknown>;
  conversationId?: string;
};

export type OutboundAccepted = {
  accepted: boolean;
  callId?: string;
  messageId?: string;
};

type OutboundConfig = {
  baseUrl: string;
  secret: string;
};

/** Resolve provider outbound config from env, or null when not configured. */
export function readOutboundConfig(): OutboundConfig | null {
  const baseUrl = process.env.CRM_A_PHONE_OUTBOUND_URL?.trim();
  const secret = process.env.CRM_A_PHONE_OUTBOUND_SECRET?.trim();
  if (!baseUrl || !secret) {return null;}
  return { baseUrl: baseUrl.replace(/\/+$/, ""), secret };
}

export class OutboundNotConfiguredError extends Error {
  constructor() {
    super(
      "Phone outbound is not configured. Set CRM_A_PHONE_OUTBOUND_URL and CRM_A_PHONE_OUTBOUND_SECRET.",
    );
    this.name = "OutboundNotConfiguredError";
  }
}

async function postOutbound(path: string, payload: unknown): Promise<OutboundAccepted> {
  const config = readOutboundConfig();
  if (!config) {throw new OutboundNotConfiguredError();}
  const res = await fetch(`${config.baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.secret}`,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Outbound ${path} failed (${res.status}): ${detail}`);
  }
  const data = (await res.json()) as OutboundAccepted;
  if (data.accepted !== true) {
    throw new Error(`Provider did not accept outbound ${path}.`);
  }
  return data;
}

/** Trigger an outbound phone call through the provider. */
export async function triggerDial(request: DialRequest): Promise<OutboundAccepted> {
  return postOutbound("/outbound/dial", {
    phone: request.phone,
    purpose: request.purpose,
    prompt: request.prompt,
    context: request.context,
    conversationId: request.conversationId,
  });
}

/** Trigger an outbound Telegram message through the provider. */
export async function triggerTelegramSend(
  request: TelegramSendRequest,
): Promise<OutboundAccepted> {
  return postOutbound("/outbound/telegram", {
    to: request.to,
    text: request.text,
    context: request.context,
    conversationId: request.conversationId,
  });
}
