import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const {
  fetchComposioConnectionsMock,
  fetchComposioMcpToolsListMock,
} = vi.hoisted(() => ({
  fetchComposioConnectionsMock: vi.fn(),
  fetchComposioMcpToolsListMock: vi.fn(),
}));

vi.mock("@/lib/composio", () => ({
  fetchComposioConnections: fetchComposioConnectionsMock,
  fetchComposioMcpToolsList: fetchComposioMcpToolsListMock,
  resolveComposioApiKey: vi.fn(),
  resolveComposioEligibility: vi.fn(),
  resolveComposioGatewayUrl: vi.fn(),
}));

vi.mock("@/lib/composio-client", () => ({
  extractComposioConnections: (input: unknown) => input,
  normalizeComposioConnections: (input: unknown) => input,
  normalizeComposioToolkitSlug: (slug: string) => slug.trim().toLowerCase(),
}));

vi.mock("@/lib/workspace", () => ({
  resolveWorkspaceRoot: vi.fn(),
}));

import { buildComposioToolIndex } from "@/lib/composio-tool-index";

describe("buildComposioToolIndex", () => {
  let workspaceDir: string | undefined;

  afterEach(() => {
    vi.clearAllMocks();
    if (workspaceDir) {
      rmSync(workspaceDir, { recursive: true, force: true });
      workspaceDir = undefined;
    }
  });

  it("persists recipe tools with their input schemas in the local index", async () => {
    workspaceDir = mkdtempSync(path.join(os.tmpdir(), "dench-composio-index-"));

    fetchComposioConnectionsMock.mockResolvedValue([
      {
        is_active: true,
        normalized_toolkit_slug: "gmail",
        toolkit_name: "gmail",
        account_identity: "user@gmail.com",
      },
    ]);

    fetchComposioMcpToolsListMock.mockResolvedValue([
      {
        name: "GMAIL_FETCH_EMAILS",
        title: "Fetch emails",
        description: "Fetch recent Gmail messages.",
        inputSchema: {
          type: "object",
          properties: {
            label_ids: {
              type: "array",
              items: { type: "string" },
            },
            max_results: {
              type: "number",
            },
          },
        },
        annotations: { readOnlyHint: true },
      },
      {
        name: "GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID",
        title: "Fetch message",
        description: "Fetch one Gmail message.",
        inputSchema: {
          type: "object",
          properties: {
            message_id: {
              type: "string",
            },
          },
          required: ["message_id"],
        },
        annotations: { readOnlyHint: true },
      },
      {
        name: "GMAIL_SEND_EMAIL",
        title: "Send email",
        description: "Send a Gmail message.",
        inputSchema: {
          type: "object",
          properties: {
            to: { type: "string" },
            subject: { type: "string" },
            body: { type: "string" },
          },
          required: ["to", "subject", "body"],
        },
      },
      {
        name: "GMAIL_GET_LABEL",
        title: "Get label",
        description: "Get Gmail label metadata.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string" },
          },
          required: ["id"],
        },
        annotations: { readOnlyHint: true },
      },
    ]);

    const index = await buildComposioToolIndex({
      workspaceDir,
      gatewayUrl: "https://gateway.example.com",
      apiKey: "dc-key",
    });

    const gmail = index.connected_apps[0];
    expect(gmail.recipes).toMatchObject({
      "Read recent emails": "GMAIL_FETCH_EMAILS",
      "Read one email": "GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID",
      "Send email": "GMAIL_SEND_EMAIL",
    });

    expect(gmail.tools.map((tool) => tool.name)).toEqual([
      "GMAIL_FETCH_EMAILS",
      "GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID",
      "GMAIL_SEND_EMAIL",
      "GMAIL_GET_LABEL",
    ]);
    expect(gmail.tools[0]?.input_schema).toMatchObject({
      type: "object",
      properties: {
        label_ids: {
          type: "array",
        },
      },
    });
    expect(gmail.tools[2]?.input_schema).toMatchObject({
      required: ["to", "subject", "body"],
    });

    const written = JSON.parse(
      readFileSync(path.join(workspaceDir, "composio-tool-index.json"), "utf-8"),
    );
    expect(written.connected_apps[0].tools[2].input_schema.required).toEqual([
      "to",
      "subject",
      "body",
    ]);
  });
});
