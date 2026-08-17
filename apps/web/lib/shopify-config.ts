import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { resolveOpenClawStateDir } from "./workspace";

/**
 * Shopify webhook/touchpoint config, per workspace, at
 * `<stateDir>/.crm-a-shopify.json` (entered from the Integrations UI).
 * Env (`SHOPIFY_API_SECRET` / `SHOPIFY_STORE_DOMAIN` / `SHOPIFY_ADMIN_TOKEN`)
 * wins when set — e.g. the Docker compose — otherwise the config file is used.
 *
 * `apiSecret` is the Shopify app's API secret key (client secret), used to
 * verify the webhook HMAC signature (`X-Shopify-Hmac-Sha256`). `adminToken`
 * is the Admin API access token (`shpat_…`) used by the `shopify_admin` tool
 * and the helper CLIs — a different credential for a different purpose.
 */

export type ShopifyConfig = {
  /** Shopify app API secret key — verifies webhook HMAC. */
  apiSecret: string;
  /** e.g. "my-store.myshopify.com" — store host for webhooks + Admin API. */
  storeDomain?: string;
  /** Admin API access token (shpat_…) — chat tool + CLI helpers. */
  adminToken?: string;
  /** Admin API version (default 2024-10). */
  apiVersion?: string;
};

function configPath(): string {
  return path.join(resolveOpenClawStateDir(), ".crm-a-shopify.json");
}

export function readShopifyConfig(): ShopifyConfig | null {
  const filePath = configPath();
  if (!existsSync(filePath)) {return null;}
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf-8")) as Partial<ShopifyConfig>;
    if (typeof parsed.apiSecret === "string" && parsed.apiSecret.trim()) {
      return {
        apiSecret: parsed.apiSecret.trim(),
        storeDomain: typeof parsed.storeDomain === "string" && parsed.storeDomain.trim()
          ? parsed.storeDomain.trim()
          : undefined,
        adminToken: typeof parsed.adminToken === "string" && parsed.adminToken.trim()
          ? parsed.adminToken.trim()
          : undefined,
        apiVersion: typeof parsed.apiVersion === "string" && parsed.apiVersion.trim()
          ? parsed.apiVersion.trim()
          : undefined,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function writeShopifyConfig(config: ShopifyConfig): void {
  const filePath = configPath();
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(config, null, 2)}\n`, "utf-8");
}

export function deleteShopifyConfig(): void {
  const filePath = configPath();
  if (existsSync(filePath)) {
    writeFileSync(filePath, "", "utf-8");
  }
}

/**
 * Effective webhook HMAC secret: env wins, then the config file.
 * When unset, Shopify webhooks cannot be HMAC-verified.
 */
export function readShopifyHmacSecret(): string | undefined {
  const envSecret = process.env.SHOPIFY_API_SECRET?.trim();
  if (envSecret) {return envSecret;}
  return readShopifyConfig()?.apiSecret ?? undefined;
}

/** Effective store domain (display only). */
export function readShopifyStoreDomain(): string | undefined {
  const envDomain = process.env.SHOPIFY_STORE_DOMAIN?.trim();
  if (envDomain) {return envDomain;}
  return readShopifyConfig()?.storeDomain ?? undefined;
}
 
/** Effective Admin API token; environment wins over the workspace config. */
export function readShopifyAdminToken(): string | undefined {
  const envToken = process.env.SHOPIFY_ADMIN_TOKEN?.trim();
  if (envToken) {return envToken;}
  return readShopifyConfig()?.adminToken ?? undefined;
}

/** Effective Admin API version; environment wins over the workspace config. */
export function readShopifyApiVersion(): string | undefined {
  const envVersion = process.env.SHOPIFY_API_VERSION?.trim();
  if (envVersion) {return envVersion;}
  return readShopifyConfig()?.apiVersion ?? undefined;
}