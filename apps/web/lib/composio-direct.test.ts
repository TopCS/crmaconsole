import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";

let stateDir = "";

vi.mock("@/lib/workspace", () => ({
  resolveOpenClawStateDir: vi.fn(() => stateDir),
}));

const {
  directInitiateConnect,
  readDirectComposioConfig,
  resolveDirectComposioApiKey,
  writeDirectComposioConfig,
  deleteDirectComposioConfig,
} = await import("./composio-direct");

describe("composio-direct config", () => {
  beforeEach(() => {
    stateDir = path.join(
      os.tmpdir(),
      `crm-a-composio-direct-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(stateDir, { recursive: true });
    delete process.env.COMPOSIO_API_KEY;
  });

  afterEach(() => {
    rmSync(stateDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("env key wins over the stored config", () => {
    writeDirectComposioConfig({ apiKey: "stored-key" });
    expect(resolveDirectComposioApiKey()).toBe("stored-key");
    process.env.COMPOSIO_API_KEY = "env-key";
    expect(resolveDirectComposioApiKey()).toBe("env-key");
  });

  it("delete clears the stored key", () => {
    writeDirectComposioConfig({ apiKey: "stored-key" });
    deleteDirectComposioConfig();
    expect(readDirectComposioConfig()).toBeNull();
    expect(resolveDirectComposioApiKey()).toBeNull();
  });
});

describe("directInitiateConnect", () => {
  beforeEach(() => {
    delete process.env.COMPOSIO_API_KEY;
    process.env.COMPOSIO_API_KEY = "test-key";
  });

  afterEach(() => {
    delete process.env.COMPOSIO_API_KEY;
    vi.restoreAllMocks();
  });

  it("reuses an existing managed auth config and returns the redirect url", async () => {
    const calls: Array<{ url: string; method: string; body?: unknown }> = [];
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.includes("/api/v3.1/auth_configs?")) {
        return new Response(JSON.stringify({ items: [{ id: "ac_existing" }] }));
      }
      if (url.endsWith("/api/v3.1/connected_accounts/link")) {
        return new Response(
          JSON.stringify({ redirect_url: "https://connect.example/xyz", connected_account_id: "ca_1" }),
          { status: 201 },
        );
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof fetch;

    const result = await directInitiateConnect({
      toolkit: "gmail",
      callbackUrl: "https://app.example/api/composio/callback",
      userId: "crm-a-console",
    });

    expect(result.redirect_url).toBe("https://connect.example/xyz");
    // No auth_config creation when one already exists.
    expect(calls.some((c) => c.method === "POST" && c.url.endsWith("/api/v3.1/auth_configs"))).toBe(false);
    const linkCall = calls.find((c) => c.url.endsWith("/connected_accounts/link"));
    expect(linkCall?.body).toMatchObject({
      auth_config_id: "ac_existing",
      user_id: "crm-a-console",
      callback_url: "https://app.example/api/composio/callback",
    });
  });

  it("creates the auth config when none exists", async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/v3.1/auth_configs?")) {
        return new Response(JSON.stringify({ items: [] }));
      }
      if (url.endsWith("/api/v3.1/auth_configs") && init?.method === "POST") {
        return new Response(JSON.stringify({ auth_config: { id: "ac_new" } }));
      }
      if (url.endsWith("/api/v3.1/connected_accounts/link")) {
        return new Response(JSON.stringify({ redirect_url: "https://connect.example/new" }), { status: 201 });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof fetch;

    const result = await directInitiateConnect({
      toolkit: "gmail",
      callbackUrl: "https://app.example/cb",
      userId: "crm-a-console",
    });

    expect(result.redirect_url).toBe("https://connect.example/new");
  });
});
