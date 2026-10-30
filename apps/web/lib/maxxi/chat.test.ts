import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildTools,
  resolveChatModel,
  runChatLoop,
  toolNamesForRoles,
  type ChatTool,
  type FetchLike,
} from "./chat";
import type { AgentAnswer } from "./agent";

const deterministic: (question: string) => Promise<AgentAnswer> = async (question) => ({
  question,
  intent: "unknown",
  answer: "Non ho evidenze sufficienti su questo punto nei dati dimostrativi caricati.",
  grounded: false,
  evidence: [],
  citations: [],
  fallback: true,
});

const sourcesTool: ChatTool = {
  name: "maxxi_sources",
  description: "sources",
  parameters: { type: "object", properties: {} },
  async execute() {
    return {
      grounded: true,
      summary: "2 fonti",
      data: [{ sourceSystem: "SITE_FORM" }],
      evidence: [{ kind: "source", id: "SITE_FORM" }],
      citations: ["maxxi_source_registry"],
    };
  },
};

const emptyTool: ChatTool = {
  name: "maxxi_sources",
  description: "sources",
  parameters: { type: "object", properties: {} },
  async execute() {
    return { grounded: false, summary: "niente", evidence: [], citations: [] };
  },
};

function toolCallResponse(name = "maxxi_sources"): Response {
  return Response.json({
    choices: [
      {
        message: {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call-1",
              type: "function",
              function: { name, arguments: "{}" },
            },
          ],
        },
      },
    ],
  });
}

function textResponse(content: string): Response {
  return Response.json({ choices: [{ message: { role: "assistant", content } }] });
}

function sequence(...responses: Response[]): FetchLike {
  let index = 0;
  return async () => {
    const response = responses[index] ?? responses[responses.length - 1];
    index += 1;
    return response;
  };
}

const originalModel = process.env.MAXXI_CHAT_MODEL;

afterEach(() => {
  if (originalModel === undefined) {delete process.env.MAXXI_CHAT_MODEL;}
  else {process.env.MAXXI_CHAT_MODEL = originalModel;}
  vi.restoreAllMocks();
});

describe("tool permissions", () => {
  it("gives admin every read tool", () => {
    expect(toolNamesForRoles(["admin"])).toEqual([
      "maxxi_sources",
      "maxxi_campaigns",
      "maxxi_person_360",
      "maxxi_segment_arch_renewal",
      "maxxi_ask",
    ]);
  });

  it("keeps infopoint on people/sources but not the eligible segment", () => {
    const tools = toolNamesForRoles(["infopoint"]);
    expect(tools).toContain("maxxi_person_360");
    expect(tools).not.toContain("maxxi_segment_arch_renewal");
    expect(tools).not.toContain("maxxi_ask");
  });

  it("gives relations only non-personal tools", () => {
    expect(toolNamesForRoles(["relations"])).toEqual(["maxxi_sources", "maxxi_campaigns"]);
  });

  it("builds only the requested tools", () => {
    expect(buildTools(["maxxi_sources"]).map((tool) => tool.name)).toEqual(["maxxi_sources"]);
  });
});

describe("runChatLoop", () => {
  it("falls back deterministically without a provider key", async () => {
    const result = await runChatLoop({
      question: "Quali fonti?",
      tools: [sourcesTool],
      apiKey: null,
      model: "test/model",
      deterministic,
    });
    expect(result.mode).toBe("fallback");
    expect(result.fallbackReason).toBe("provider_not_configured");
    expect(result.answer).toContain("Non ho evidenze");
  });

  it("answers after a grounded tool call", async () => {
    const result = await runChatLoop({
      question: "Quali fonti abbiamo?",
      tools: [sourcesTool],
      apiKey: "test-key",
      model: "test/model",
      fetchImpl: sequence(toolCallResponse(), textResponse("Abbiamo 2 fonti registrate.")),
      deterministic,
    });
    expect(result.mode).toBe("llm");
    expect(result.answer).toContain("2 fonti");
    expect(result.toolsUsed).toEqual(["maxxi_sources"]);
    expect(result.evidence).toEqual([{ kind: "source", id: "SITE_FORM" }]);
    expect(result.citations).toContain("maxxi_source_registry");
  });

  it("rejects prose produced without any tool call", async () => {
    const result = await runChatLoop({
      question: "Quanti visitatori?",
      tools: [sourcesTool],
      apiKey: "test-key",
      model: "test/model",
      fetchImpl: sequence(textResponse("Ci sono 42 visitatori.")),
      deterministic,
    });
    expect(result.mode).toBe("fallback");
    expect(result.fallbackReason).toBe("answer_without_tools");
  });

  it("keeps a refusal ungrounded even if an unrelated tool returned data", async () => {
    const result = await runChatLoop({
      question: "Chi è Maria Rossi?",
      tools: [sourcesTool],
      apiKey: "test-key",
      model: "test/model",
      fetchImpl: sequence(
        toolCallResponse(),
        textResponse("Non ho evidenze sufficienti su questo punto nei dati demo caricati."),
      ),
      deterministic,
    });
    expect(result.mode).toBe("llm");
    expect(result.grounded).toBe(false);
    expect(result.evidence).toEqual([]);
    expect(result.citations).toEqual([]);
  });

  it("rejects an unknown tool and falls back", async () => {
    const result = await runChatLoop({
      question: "Invia una email",
      tools: [sourcesTool],
      apiKey: "test-key",
      model: "test/model",
      fetchImpl: sequence(
        toolCallResponse("maxxi_send_email"),
        textResponse("Fatto."),
      ),
      deterministic,
    });
    expect(result.mode).toBe("fallback");
    expect(result.toolsUsed).toEqual([]);
  });

  it("falls back when tools return no evidence", async () => {
    const result = await runChatLoop({
      question: "Quanti visitatori?",
      tools: [emptyTool],
      apiKey: "test-key",
      model: "test/model",
      fetchImpl: sequence(toolCallResponse(), textResponse("Ci sono 42 visitatori.")),
      deterministic,
    });
    expect(result.mode).toBe("fallback");
    expect(result.fallbackReason).toBe("tools_without_evidence");
  });

  it("falls back on provider errors and unreachable providers", async () => {
    const http = await runChatLoop({
      question: "Quali fonti?",
      tools: [sourcesTool],
      apiKey: "test-key",
      model: "test/model",
      fetchImpl: async () => new Response("boom", { status: 500 }),
      deterministic,
    });
    expect(http.mode).toBe("fallback");
    expect(http.fallbackReason).toBe("provider_http_500");

    const offline = await runChatLoop({
      question: "Quali fonti?",
      tools: [sourcesTool],
      apiKey: "test-key",
      model: "test/model",
      fetchImpl: async () => {
        throw new Error("offline");
      },
      deterministic,
    });
    expect(offline.mode).toBe("fallback");
    expect(offline.fallbackReason).toBe("provider_unreachable");
  });

  it("never exposes a tool that was not allowlisted", () => {
    const tools = buildTools(["maxxi_sources", "maxxi_campaigns"]);
    expect(tools.some((tool) => tool.name === "maxxi_person_360")).toBe(false);
  });
});

describe("resolveChatModel", () => {
  it("strips the openrouter prefix", () => {
    process.env.MAXXI_CHAT_MODEL = "openrouter/inception/mercury-2.5";
    expect(resolveChatModel()).toBe("inception/mercury-2.5");
  });
});
