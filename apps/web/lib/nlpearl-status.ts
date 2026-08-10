/**
 * NLPearl outcome → Crm-A Console status mapping.
 *
 * Pure, tested mapping from NLPearl's documented call/lead statuses to our
 * `campaign_send` status and to the (boolean-ish) flags the Call interaction
 * carries. Kept separate from the webhook routes so the contract is single-
 * sourced and unit-testable.
 */

import type { NlpearlConversationStatus, NlpearlLeadStatus } from "./nlpearl";

/** Our per-recipient campaign_send status (mirrors campaigns.ts SendStatus). */
export type NlpearlSendStatus =
  | "Queued"
  | "Sent"
  | "Failed"
  | "Cancelled";

/**
 * Map a lead's status to the recipient-send status. Terminal classifications:
 * Success/Completed/VoiceMailLeft/NotSuccessful → Sent (an attempt happened);
 * retry-able → Queued; unreachable/error/wrong-code → Failed; blacklisted →
 * Cancelled (suppressed, do not re-contact).
 */
export function mapNlpearlLeadStatus(status: NlpearlLeadStatus): NlpearlSendStatus {
  switch (status) {
    case "Success":
    case "Completed":
    case "VoiceMailLeft":
    case "NotSuccessful":
      return "Sent";
    case "NeedRetry":
    case "InCallQueue":
    case "New":
    case "OnCall":
      return "Queued";
    case "Unreachable":
    case "WrongCountryCode":
    case "QueueAbandon":
    case "Error":
      return "Failed";
    case "Blacklisted":
      return "Cancelled";
  }
}

export type CallOutcome = "success" | "contacted" | "noanswer" | "failed";

/**
 * Classify a call-webhook conversationStatus into a coarse outcome for the
 * interaction record and the persona timeline.
 */
export function classifyCallConversationStatus(
  status: NlpearlConversationStatus,
): CallOutcome {
  switch (status) {
    case "Success":
      return "success";
    case "VoiceMailLeft":
    case "NotSuccessful":
    case "Completed":
      return "contacted";
    case "NeedRetry":
    case "InCallQueue":
    case "OnCall":
      return "failed";
    case "Unreachable":
    case "Blacklisted":
    case "QueueAbandon":
    case "Error":
      return "failed";
  }
}

/** Normalize a numeric lead status code to its named value (or null). */
export function leadStatusFromCode(code: number): NlpearlLeadStatus | null {
  const entry = Object.entries(L_LEAD) as Array<[NlpearlLeadStatus, number]>;
  return entry.find(([, c]) => c === code)?.[0] ?? null;
}

/** Normalize a numeric conversation status code to its named value (or null). */
export function conversationStatusFromCode(code: number): NlpearlConversationStatus | null {
  const entry = Object.entries(L_CONV) as Array<[NlpearlConversationStatus, number]>;
  return entry.find(([, c]) => c === code)?.[0] ?? null;
}

const L_LEAD = {
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
} as const;

const L_CONV = {
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
} as const;
