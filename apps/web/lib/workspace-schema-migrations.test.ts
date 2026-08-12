import { describe, expect, it } from "vitest";
import {
  CAMPAIGN_NEW_FIELDS,
  CAMPAIGN_SEND_NEW_FIELDS,
} from "./workspace-schema-migrations";

describe("workspace-schema-migrations field additions", () => {
  it("adds a Voice Brief field to the campaign object for the NLPearl voice script", () => {
    const brief = CAMPAIGN_NEW_FIELDS.find((f) => f.name === "Voice Brief");
    expect(brief).toBeDefined();
    expect(brief?.type).toBe("text");
  });

  it("defines the campaign_send External ID field (previously referenced but missing)", () => {
    expect(Array.isArray(CAMPAIGN_SEND_NEW_FIELDS)).toBe(true);
    const ext = CAMPAIGN_SEND_NEW_FIELDS.find((f) => f.name === "External ID");
    expect(ext).toBeDefined();
    expect(ext?.type).toBe("text");
  });

  it("keeps Voice Brief sortOrder after the existing calling config fields", () => {
    const agents = CAMPAIGN_NEW_FIELDS.find((f) => f.name === "Nlpearl Agent Count");
    const brief = CAMPAIGN_NEW_FIELDS.find((f) => f.name === "Voice Brief");
    expect(brief?.sortOrder).toBeGreaterThan(agents?.sortOrder ?? 0);
  });
});
