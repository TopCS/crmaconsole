/**
 * NLPearl inbound customer-care Pearl (Fase D).
 *
 * Builds an Inbound Pearl (type 1) whose PreCallAPI node fetches the CRM
 * context (via /api/nlpearl/precall) before the opening, so the agent greets
 * with memory ("Bentornato Lorenzo … ordine/corriere") and handles the call
 * from the marketing brief when provided.
 */

import { createVoicePearl, resolveVoiceId } from "./nlpearl";
import { readPhoneWebhookSecret } from "./phone-webhook";

export type InboundPearlParams = {
  origin: string;
  name: string;
  phoneId?: string;
  /** Optional Marketing Message MD/instructions the agent should speak. */
  brief?: string;
  companyName?: string;
  personality?: string;
};

export type InboundPearlPayload = {
  name: string;
  pearl: {
    companyName: string;
    agentPersonality: string;
    modelType: number;
    agents: Array<{ name: string; voiceId: string }>;
    nodes: Array<Record<string, unknown>>;
  };
  variables: Array<{ id: string; name: string; group: number }>;
  inbound: {
    phoneNumberId?: string;
    totalAgents: number;
    callWebhookUrl?: string;
  };
};

/** Pure payload builder — unit-testable without network. */
export function buildInboundPearlPayload(params: InboundPearlParams & {
  voiceId: string;
  precallUrl: string;
  callWebhookUrl: string;
}): InboundPearlPayload {
  const instructions = [
    "Usa il contesto del cliente per personalizzare la conversazione.",
    "Se il cliente parla di un ordine, usa i dati di consegna forniti.",
  ];
  if (params.brief?.trim()) {
    instructions.push("Contenuto dell'offerta da comunicare:");
    instructions.push(params.brief.trim().slice(0, 8000));
  }
  return {
    name: params.name,
    pearl: {
      companyName: params.companyName ?? "Crm-A",
      agentPersonality: params.personality ?? "Professional and warm",
      modelType: 3,
      agents: [{ name: "Agent", voiceId: params.voiceId }],
      nodes: [
        {
          nodeId: "lookup", name: "Lookup cliente", nodeType: 3,
          apiSettings: {
            name: "Contesto CRM",
            method: 1, // GET
            endpointUrl: params.precallUrl,
            description: "Recupera identità e ordini del cliente dal CRM.",
            outputBody: [
              { key: "firstName", variableId: "firstName" },
              { key: "context", variableId: "context" },
            ],
          },
          transitions: [
            { name: "Cliente trovato", toNodeId: "openKnown", apiResult: 1 },
            { name: "Cliente non trovato", toNodeId: "openUnknown", apiResult: 2 },
          ],
        },
        {
          nodeId: "openKnown", name: "Saluto cliente noto", nodeType: 2,
          script: "Buongiorno {firstName}, come posso aiutarla?",
          instructions: instructions.join("\n"),
          transitions: [{ name: "ok", toNodeId: "speak" }],
        },
        {
          nodeId: "openUnknown", name: "Saluto nuovo cliente", nodeType: 2,
          script: "Buongiorno, come posso aiutarla?",
          transitions: [{ name: "ok", toNodeId: "speak" }],
        },
        {
          nodeId: "speak", name: "Conversazione", nodeType: 10,
          script: "Come posso esserle utile oggi?",
          instructions: instructions.join("\n"),
          transitions: [{ name: "fine", toNodeId: "end" }],
        },
        { nodeId: "end", name: "Fine", nodeType: 100, transitions: [] },
      ],
    },
    variables: [
      { id: "firstName", name: "Nome", group: 1 },
      { id: "context", name: "Contesto CRM", group: 1 },
    ],
    inbound: {
      ...(params.phoneId ? { phoneNumberId: params.phoneId } : {}),
      totalAgents: 5,
      callWebhookUrl: params.callWebhookUrl,
    },
  };
}

/**
 * Create the inbound customer-care Pearl. Returns the NLPearl Pearl ID.
 */
export async function createInboundPearl(params: InboundPearlParams): Promise<string> {
  const voiceId = params.phoneId ? await resolveVoiceId() : await resolveVoiceId();
  if (!voiceId) {
    throw new Error("No NLPearl voice configured. Set NLPEARL_VOICE_ID or provision a voice.");
  }
  const token = readPhoneWebhookSecret() ?? undefined;
  const base = params.origin.replace(/\/+$/, "");
  const q = token ? `?token=${encodeURIComponent(token)}` : "";
  const payload = buildInboundPearlPayload({
    ...params,
    voiceId,
    precallUrl: `${base}/api/nlpearl/precall${q}&phone={phoneNumber}`.replace("&&", "&"),
    callWebhookUrl: `${base}/api/nlpearl/webhook/call${q}`,
  });
  return createVoicePearl(payload as unknown as Record<string, unknown>);
}