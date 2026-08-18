import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  fetchComposioConnectionsMock,
  fetchComposioMcpToolsListMock,
  refreshIntegrationsRuntimeMock,
  resolveOpenClawStateDirMock,
  resolveComposioModeMock,
} = vi.hoisted(() => ({
  fetchComposioConnectionsMock: vi.fn(),
  fetchComposioMcpToolsListMock: vi.fn(),
  refreshIntegrationsRuntimeMock: vi.fn(),
  resolveOpenClawStateDirMock: vi.fn(),
  resolveComposioModeMock: vi.fn(),
}));

vi.mock("@/lib/composio", () => ({
  fetchComposioConnections: fetchComposioConnectionsMock,
  fetchComposioMcpToolsList: fetchComposioMcpToolsListMock,
  resolveComposioApiKey: vi.fn(() => "crm_a_test_key"),
  resolveComposioEligibility: vi.fn(() => ({
    eligible: true,
    lockReason: null,
    lockBadge: null,
  })),
  resolveComposioGatewayUrl: vi.fn(() => "https://gateway.example.com"),
  resolveComposioMode: resolveComposioModeMock,
}));

vi.mock("@/lib/integrations", () => ({
  refreshIntegrationsRuntime: refreshIntegrationsRuntimeMock,
}));

vi.mock("@/lib/workspace", () => ({
  resolveActiveAgentId: vi.fn(() => "main"),
  resolveOpenClawStateDir: resolveOpenClawStateDirMock,
  resolveWorkspaceRoot: vi.fn(() => "/tmp/workspace"),
}));

vi.mock("@/lib/agent-runner", () => ({
  spawnAgentStartForSession: vi.fn(),
}));

vi.mock("../../../src/cli/crm-a-cloud", () => ({
  buildComposioMcpServerConfig: vi.fn((gatewayUrl: string, apiKey: string) => ({
    url: `${gatewayUrl}/v1/composio/mcp`,
    transport: "streamable-http",
    headers: { Authorization: `Bearer ${apiKey}` },
  })),
}));

const { getComposioMcpHealth } = await import("./composio-mcp-health");

describe("Composio MCP health", () => {
  let stateDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    stateDir = mkdtempSync(join(tmpdir(), "crm-a-composio-health-"));
    resolveOpenClawStateDirMock.mockReturnValue(stateDir);
    fetchComposioMcpToolsListMock.mockResolvedValue([{ name: "GMAIL_FETCH_EMAILS" }]);
    fetchComposioConnectionsMock.mockResolvedValue({ items: [] });
    resolveComposioModeMock.mockReturnValue("cloud");
    refreshIntegrationsRuntimeMock.mockResolvedValue({
      attempted: true,
      restarted: true,
      error: null,
      profile: "crm-a",
    });
  });

  afterEach(() => {
    rmSync(stateDir, { recursive: true, force: true });
  });

  it("self-heals a missing composio MCP server during status refresh", async () => {
    writeFileSync(join(stateDir, "openclaw.json"), JSON.stringify({ mcp: { servers: {} } }));

    const health = await getComposioMcpHealth({ autoRepairConfig: true });
    const config = JSON.parse(readFileSync(join(stateDir, "openclaw.json"), "utf-8")) as {
      mcp?: {
        servers?: {
          composio?: {
            url?: string;
            transport?: string;
            headers?: { Authorization?: string };
          };
        };
      };
    };

    expect(config.mcp?.servers?.composio).toEqual({
      url: "https://gateway.example.com/v1/composio/mcp",
      transport: "streamable-http",
      headers: { Authorization: "Bearer crm_a_test_key" },
    });
    expect(health.config.status).toBe("pass");
    expect(health.summary.level).toBe("healthy");
    expect(health.liveAgent.detail).toMatch(/Configuration repaired/);
    expect(refreshIntegrationsRuntimeMock).toHaveBeenCalledTimes(1);
  });

  it("reports direct-mode health without probing the cloud gateway", async () => {
    resolveComposioModeMock.mockReturnValue("direct");
    fetchComposioConnectionsMock.mockResolvedValue({ items: [] });

    const health = await getComposioMcpHealth();

    expect(fetchComposioMcpToolsListMock).not.toHaveBeenCalled();
    expect(fetchComposioConnectionsMock).toHaveBeenCalledTimes(1);
    expect(health.config.status).toBe("unknown");
    expect(health.gatewayTools.status).toBe("unknown");
    expect(health.summary.level).toBe("healthy");
    expect(health.summary.message).toMatch(/direct Composio mode/);
  });

  it("reports direct-mode error when the key cannot reach Composio", async () => {
    resolveComposioModeMock.mockReturnValue("direct");
    fetchComposioConnectionsMock.mockRejectedValue(new Error("HTTP 401"));

    const health = await getComposioMcpHealth();

    expect(fetchComposioMcpToolsListMock).not.toHaveBeenCalled();
    expect(health.summary.level).toBe("error");
    expect(health.summary.message).toMatch(/could not reach Composio/);
  });
});
