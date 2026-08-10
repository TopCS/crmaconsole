import { describe, expect, it } from "vitest";
import {
  classifyCallConversationStatus,
  conversationStatusFromCode,
  leadStatusFromCode,
  mapNlpearlLeadStatus,
} from "./nlpearl-status";

describe("nlpearl-status", () => {
  it("maps lead status → our campaign_send status", () => {
    expect(mapNlpearlLeadStatus("Success")).toBe("Sent");
    expect(mapNlpearlLeadStatus("Completed")).toBe("Sent");
    expect(mapNlpearlLeadStatus("VoiceMailLeft")).toBe("Sent");
    expect(mapNlpearlLeadStatus("NeedRetry")).toBe("Queued");
    expect(mapNlpearlLeadStatus("New")).toBe("Queued");
    expect(mapNlpearlLeadStatus("Unreachable")).toBe("Failed");
    expect(mapNlpearlLeadStatus("WrongCountryCode")).toBe("Failed");
    expect(mapNlpearlLeadStatus("Blacklisted")).toBe("Cancelled");
  });

  it("classifies conversation status into a coarse call outcome", () => {
    expect(classifyCallConversationStatus("Success")).toBe("success");
    expect(classifyCallConversationStatus("NotSuccessful")).toBe("contacted");
    expect(classifyCallConversationStatus("VoiceMailLeft")).toBe("contacted");
    expect(classifyCallConversationStatus("Unreachable")).toBe("failed");
    expect(classifyCallConversationStatus("Error")).toBe("failed");
  });

  it("normalizes numeric codes to names (and null for unknown)", () => {
    expect(leadStatusFromCode(100)).toBe("Success");
    expect(leadStatusFromCode(220)).toBe("Blacklisted");
    expect(leadStatusFromCode(42)).toBeNull();
    expect(conversationStatusFromCode(110)).toBe("NotSuccessful");
    expect(conversationStatusFromCode(500)).toBe("Error");
    expect(conversationStatusFromCode(-1)).toBeNull();
  });
});
