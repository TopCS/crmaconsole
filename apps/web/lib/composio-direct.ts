import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { resolveOpenClawStateDir } from "./workspace";

/**
 * Direct Composio mode: talk to Composio's Platform API (v3.1) with the
 * user's own API key instead of routing through the Crm-A Cloud gateway.
 *
 * Key resolution: `COMPOSIO_API_KEY` env first, then the stored config at
 * `<stateDir>/.crm-a-composio.json` (managed from the Integrations UI).
 */

const DIRECT_API_BASE = "https://backend.composio.dev";

export type DirectComposioConfig = {
  apiKey: string;
};

function configPath(): string {
  return path.join(resolveOpenClawStateDir(), ".crm-a-composio.json");
}

export function readDirectComposioConfig(): DirectComposioConfig | null {
  const filePath = configPath();
  if (!existsSync(filePath)) {return null;}
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf-8")) as Partial<DirectComposioConfig>;
    if (typeof parsed.apiKey === "string" && parsed.apiKey.trim()) {
      return { apiKey: parsed.apiKey.trim() };
    }
  } catch {
    // fall through
  }
  return null;
}

export function writeDirectComposioConfig(config: DirectComposioConfig): void {
  const filePath = configPath();
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(config, null, 2)}\n`, "utf-8");
}

export function deleteDirectComposioConfig(): void {
  const filePath = configPath();
  if (existsSync(filePath)) {
    writeFileSync(filePath, "{}\n", "utf-8");
  }
}

/** The direct Composio API key, or null when direct mode is not configured. */
export function resolveDirectComposioApiKey(): string | null {
  const envKey = process.env.COMPOSIO_API_KEY?.trim();
  if (envKey) {return envKey;}
  return readDirectComposioConfig()?.apiKey ?? null;
}

export function isDirectComposioConfigured(): boolean {
  return resolveDirectComposioApiKey() !== null;
}

/** Authenticated fetch against Composio's Platform API (v3.1). */
export async function directComposioFetch(path: string, init?: RequestInit): Promise<Response> {
  const apiKey = resolveDirectComposioApiKey();
  if (!apiKey) {
    throw new Error("Composio API key is not configured (COMPOSIO_API_KEY or Integrations card).");
  }
  return fetch(`${DIRECT_API_BASE}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      ...init?.headers,
    },
  });
}

/**
 * Find (or create) the Composio-managed auth config for a toolkit, then
 * create a connect link for it. Two-step because v3.1 separates auth
 * configs (per toolkit) from connect links (per user).
 */
export async function directInitiateConnect(params: {
  toolkit: string;
  callbackUrl: string;
  userId: string;
}): Promise<{ redirect_url: string; connected_account_id?: string }> {
  // 1. Reuse an existing managed auth config when present.
  let authConfigId: string | null = null;
  const listRes = await directComposioFetch(
    `/api/v3.1/auth_configs?toolkit_slug=${encodeURIComponent(params.toolkit)}&limit=1`,
  );
  if (listRes.ok) {
    const list = (await listRes.json()) as { items?: Array<{ id?: string }> };
    authConfigId = list.items?.[0]?.id ?? null;
  }

  // 2. Create one when missing.
  if (!authConfigId) {
    const createRes = await directComposioFetch("/api/v3.1/auth_configs", {
      method: "POST",
      body: JSON.stringify({
        toolkit: { slug: params.toolkit },
        auth_config: { type: "use_composio_managed_auth", name: "crm-a-console" },
      }),
    });
    if (!createRes.ok) {
      const detail = await createRes.text().catch(() => "");
      throw new Error(
        `Failed to create auth config for ${params.toolkit} (HTTP ${createRes.status})${detail ? `: ${detail}` : ""}`,
      );
    }
    const created = (await createRes.json()) as {
      auth_config?: { id?: string };
      id?: string;
    };
    authConfigId = created.auth_config?.id ?? created.id ?? null;
  }
  if (!authConfigId) {
    throw new Error(`No auth config available for ${params.toolkit}.`);
  }

  // 3. Create the connect link.
  const linkRes = await directComposioFetch("/api/v3.1/connected_accounts/link", {
    method: "POST",
    body: JSON.stringify({
      auth_config_id: authConfigId,
      user_id: params.userId,
      callback_url: params.callbackUrl,
    }),
  });
  if (!linkRes.ok) {
    const detail = await linkRes.text().catch(() => "");
    throw new Error(
      `Failed to create connect link for ${params.toolkit} (HTTP ${linkRes.status})${detail ? `: ${detail}` : ""}`,
    );
  }
  const link = (await linkRes.json()) as {
    redirect_url?: string;
    connected_account_id?: string;
  };
  if (!link.redirect_url) {
    throw new Error(`Connect link for ${params.toolkit} did not return a redirect URL.`);
  }
  return { redirect_url: link.redirect_url, connected_account_id: link.connected_account_id };
}
