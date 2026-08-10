import { describe, expect, it } from "vitest";
import { buildInboundPearlPayload } from "./nlpearl-inbound";

const base = {
  origin: "https://crm.example.net",
  name: "Customer Care",
  voiceId: "v1",
  precallUrl: "https://crm.example.net/api/nlpearl/precall?phone={phoneNumber}",
  callWebhookUrl: "https://crm.example.net/api/nlpearl/webhook/call",
};

describe("buildInboundPearlPayload", () => {
  it("wires PreCallAPI → known/unknown openings → dialogue → end", () => {
    const p = buildInboundPearlPayload(base);
    const nodeIds = p.pearl.nodes.map((n) => n.nodeId);
    expect(nodeIds).toEqual(["lookup", "openKnown", "openUnknown", "speak", "end"]);

    const lookup = p.pearl.nodes[0];
    expect(lookup.nodeType).toBe(3);
    expect((lookup as { apiSettings: Record<string, unknown> }).apiSettings.method).toBe(1);
    expect((lookup as { apiSettings: { endpointUrl: string } }).apiSettings.endpointUrl).toContain(
      "/api/nlpearl/precall?phone={phoneNumber}",
    );
    const vars = p.variables.map((v) => v.id);
    // firstName is a built-in lead variable (not declarable); context is custom.
    expect(vars).toEqual(["context"]);
    expect(p.inbound.callWebhookUrl).toBe("https://crm.example.net/api/nlpearl/webhook/call");
    expect(p.inbound.phoneNumberId).toBeUndefined();
  });

  it("declares phoneId + injects the brief as speakable instructions", () => {
    const p = buildInboundPearlPayload({
      ...base,
      phoneId: "pn-1",
      brief: "## Offerta\nSamsung Galaxy S27, disponibile dal 18 ottobre.",
    });
    expect(p.inbound.phoneNumberId).toBe("pn-1");
    const speak = p.pearl.nodes.find((n) => n.nodeId === "speak") as { instructions: string };
    expect(speak.instructions).toContain("Samsung Galaxy S27");
    expect(speak.instructions).toContain("18 ottobre");
  });
});