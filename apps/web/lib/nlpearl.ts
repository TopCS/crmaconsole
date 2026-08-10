/**
 * NLPearl.AI API v2 client (typed) — phone inbound/outbound integration.
 *
 * NLPearl owns the calling + the conversational AI ("Pearls"). This console
 * drives it: adds leads (outbound), lists Pearls, reads calls, toggles
 * activity, and points the Pearl's call/lead webhooks back at the harness.
 * Payload type shapes below are from developers.nlpearl.ai/pages/webhooks.md
 * (V2, camelCase).
 *
 * Auth: `Authorization: Bearer <AccountId>:<SecretKey>` (one string),
 * from env `NLPEARL_ACCOUNT_ID` + `NLPEARL_SECRET_KEY`.
 * Endpoint `NLPEARL_BASE_URL` (default https://api.nlpearl.ai/v2).
 */

export const NLPEARL_DEFAULT_BASE_URL = "https://api.nlpearl.ai/v2";

// ---------------------------------------------------------------------------
// Enums (documented values)
// ---------------------------------------------------------------------------

/** V2 call webhook conversationStatus. */
export type NlpearlConversationStatus =
  | "NeedRetry"    // 10
  | "InCallQueue"  // 20
  | "OnCall"       // 40
  | "VoiceMailLeft"// 70
  | "Success"      // 100
  | "NotSuccessful"// 110
  | "Completed"    // 130
  | "Unreachable"  // 150
  | "Blacklisted"  // 220
  | "QueueAbandon" // 300
  | "Error";       // 500

/** V2 call webhook technical call status. */
export type NlpearlCallStatus =
  | "InProgress" // 3
  | "Completed"  // 4
  | "Busy"       // 5
  | "Failed"     // 6
  | "NoAnswer"   // 7
  | "Canceled";  // 8

/** V2 lead webhook status (outbound). */
export type NlpearlLeadStatus =
  | "New"             // 1
  | "NeedRetry"       // 10
  | "InCallQueue"     // 20
  | "WrongCountryCode"// 30
  | "OnCall"          // 40
  | "VoiceMailLeft"   // 70
  | "Success"         // 100
  | "NotSuccessful"   // 110
  | "Completed"       // 130
  | "Unreachable"     // 150
  | "Blacklisted"     // 220
  | "QueueAbandon"    // 300
  | "Error";          // 500

export const NLPEARL_CONVERSATION_STATUS_CODES: Record<NlpearlConversationStatus, number> = {
  NeedRetry: 10,
  InCallQueue: 20,
  OnCall: 40,
  VoiceMailLeft: 70,
  Success: 100,
  NotSuccessful: 110,
  Completed: 130,
  Unreachable: 150,
  Blacklisted: 220,
  QueueAbandon: 300,
  Error: 500,
};

export const NLPEARL_LEAD_STATUS_CODES: Record<NlpearlLeadStatus, number> = {
  New: 1,
  NeedRetry: 10,
  InCallQueue: 20,
  WrongCountryCode: 30,
  OnCall: 40,
  VoiceMailLeft: 70,
  Success: 100,
  NotSuccessful: 110,
  Completed: 130,
  Unreachable: 150,
  Blacklisted: 220,
  QueueAbandon: 300,
  Error: 500,
};

// ---------------------------------------------------------------------------
// Webhook payload shapes (V2)
// ---------------------------------------------------------------------------

export type NlpearlTranscriptMessage = {
  role: "Pearl" | "Client";
  content: string;
  startTime: number;
  endTime: number;
};

export type NlpearlCollectedInfo = {
  id: string;
  name: string;
  value: unknown;
};

/** V2 Call Webhook payload (shared by Inbound + Outbound Pearls). */
export type NlpearlCallWebhook = {
  id: string;
  pearlId: string;
  startTime: string;
  conversationStatus: NlpearlConversationStatus;
  status: NlpearlCallStatus;
  from: string;
  to: string;
  name: string | null;
  duration: number;
  recording?: string | null;
  transcript?: NlpearlTranscriptMessage[];
  summary?: string | null;
  collectedInfo?: NlpearlCollectedInfo[];
  tags?: string[];
  isCallTransferred?: boolean;
  overallSentiment?: string;
  leadId?: string | null;
};

/** V2 Lead Webhook payload (Outbound Pearls only). */
export type NlpearlLeadWebhook = {
  id: string;
  pearlId: string;
  externalId?: string | null;
  phoneNumber: string;
  timeZone?: string | null;
  status: NlpearlLeadStatus;
  created?: string;
  callsId?: string[];
  callData?: Record<string, unknown>;
  collectedData?: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Auth / config
// ---------------------------------------------------------------------------

export type NlpearlAuth = { accountId: string; secretKey: string };

export function readNlpearlAuth(): NlpearlAuth | null {
  const accountId = process.env.NLPEARL_ACCOUNT_ID?.trim();
  const secretKey = process.env.NLPEARL_SECRET_KEY?.trim();
  if (!accountId || !secretKey) {return null;}
  return { accountId, secretKey };
}

export function isNlpearlConfigured(): boolean {
  return readNlpearlAuth() !== null;
}

function baseUrl(): string {
  return process.env.NLPEARL_BASE_URL?.trim() || NLPEARL_DEFAULT_BASE_URL;
}

function authToken(): string {
  const auth = readNlpearlAuth();
  if (!auth) {
    throw new Error(
      "NLPearl is not configured. Set NLPEARL_ACCOUNT_ID and NLPEARL_SECRET_KEY.",
    );
  }
  return `${auth.accountId}:${auth.secretKey}`;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

async function nlpearlRequest<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${baseUrl()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${authToken()}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`NLPearl ${method} ${path} failed (${res.status}): ${detail}`);
  }
  return (await res.json()) as T;
}

export type NlpearlPearlSummary = {
  id?: string;
  name?: string;
  type?: number; // 1=Inbound, 2=Outbound
  status?: number; // 1=Running, 2=Paused, 3=Suspended
};

export async function listPearls(): Promise<NlpearlPearlSummary[]> {
  return nlpearlRequest<NlpearlPearlSummary[]>("GET", "/Pearl");
}

export async function getCall(callId: string): Promise<Record<string, unknown>> {
  return nlpearlRequest("GET", `/Call/${encodeURIComponent(callId)}`);
}

export type AddLeadParams = {
  pearlId: string;
  phoneNumber: string;
  externalId?: string;
  callData?: Record<string, unknown>;
};

export type AddLeadResult = { id?: string; status?: number; error?: string };

export async function addLead(params: AddLeadParams): Promise<AddLeadResult> {
  return nlpearlRequest<AddLeadResult>("POST", `/Outbound/${params.pearlId}/Lead`, {
    phoneNumber: params.phoneNumber,
    externalId: params.externalId,
    callData: params.callData,
  });
}

export async function setPearlActive(pearlId: string, isActive: boolean): Promise<void> {
  await nlpearlRequest("PUT", `/Pearl/${encodeURIComponent(pearlId)}/Active`, { isActive });
}

// ---------------------------------------------------------------------------
// Callback URLs (from the public origin the harness is reachable at)
// ---------------------------------------------------------------------------

export type NlpearlCallbackUrls = {
  callWebhookUrl: string;
  leadWebhookUrl: string;
};

/**
 * Build the webhook URLs that a Pearl should call back — one per channel.
 * Optional `token` is appended as a query param so the public webhook can
 * verify the caller without custom headers. Defaults to the phone webhook
 * secret (same secret used for /api/webhooks/phone + demo seed).
 */
export function buildNlpearlCallbackUrls(origin: string, token?: string): NlpearlCallbackUrls {
  const base = origin.replace(/\/+$/, "");
  const query = token ? `?token=${encodeURIComponent(token)}` : "";
  return {
    callWebhookUrl: `${base}/api/nlpearl/webhook/call${query}`,
    leadWebhookUrl: `${base}/api/nlpearl/webhook/lead${query}`,
  };
}
