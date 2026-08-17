import {
  deleteShopifyConfig,
  readShopifyApiVersion,
  readShopifyAdminToken,
  readShopifyConfig,
  readShopifyHmacSecret,
  writeShopifyConfig,
} from "@/lib/shopify-config";
import { readPhoneWebhookSecret } from "@/lib/phone-webhook";
import { resolveAppPublicOrigin } from "@/lib/public-origin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET/POST/DELETE /api/settings/shopify — manage the Shopify touchpoint
 * config (stored per workspace in `.crm-a-shopify.json`). GET masks the
 * secret, reports the source and the webhook URL to configure on the Shopify
 * dev store (HMAC via `X-Shopify-Hmac-Sha256`). Env vars win for HMAC at
 * runtime; the UI writes the config file.
 */

function webhookUrl(req: Request, token: string | undefined): string {
  const base = resolveAppPublicOrigin(req).replace(/\/+$/, "");
  return token ? `${base}/api/webhooks/shopify?token=${encodeURIComponent(token)}` : `${base}/api/webhooks/shopify`;
}

export async function GET(req: Request) {
  const secret = readPhoneWebhookSecret() ?? undefined;
  const cfg = readShopifyConfig();
  const envSecret = process.env.SHOPIFY_API_SECRET?.trim();
  const envDomain = process.env.SHOPIFY_STORE_DOMAIN?.trim();
  const envAdminToken = process.env.SHOPIFY_ADMIN_TOKEN?.trim();
  const envApiVersion = process.env.SHOPIFY_API_VERSION?.trim();
  const hmacSecret = readShopifyHmacSecret();
  const adminToken = readShopifyAdminToken();
  const apiVersion = readShopifyApiVersion();

  if (envSecret || envAdminToken) {
    return Response.json({
      configured: Boolean(envSecret),
      source: "env",
      apiSecretMasked: envSecret ? `••••${envSecret.slice(-4)}` : undefined,
      adminTokenMasked: envAdminToken ? `••••${envAdminToken.slice(-4)}` : undefined,
      storeDomain: envDomain,
      apiVersion: envApiVersion ?? apiVersion ?? "2024-10",
      webhookUrl: webhookUrl(req, secret),
      hmacEnabled: Boolean(hmacSecret),
      adminApiEnabled: Boolean(adminToken && (envDomain ?? cfg?.storeDomain)),
    });
  }
  if (!cfg) {
    return Response.json({
      configured: false,
      webhookUrl: webhookUrl(req, secret),
      hmacEnabled: Boolean(hmacSecret),
      adminApiEnabled: false,
    });
  }
  return Response.json({
    configured: true,
    source: "config",
    apiSecretMasked: `••••${cfg.apiSecret.slice(-4)}`,
    adminTokenMasked: cfg.adminToken ? `••••${cfg.adminToken.slice(-4)}` : undefined,
    storeDomain: cfg.storeDomain,
    apiVersion: cfg.apiVersion ?? "2024-10",
    webhookUrl: webhookUrl(req, secret),
    hmacEnabled: true,
    adminApiEnabled: Boolean(cfg.adminToken && cfg.storeDomain),
  });
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const existing = readShopifyConfig();
  const apiSecret = typeof body.apiSecret === "string" ? body.apiSecret.trim() : "";
  if (!apiSecret) {
    return Response.json({ error: "apiSecret is required." }, { status: 400 });
  }
  const storeDomain = typeof body.storeDomain === "string" && body.storeDomain.trim()
    ? body.storeDomain.trim()
    : existing?.storeDomain;
  const adminToken = typeof body.adminToken === "string" && body.adminToken.trim()
    ? body.adminToken.trim()
    : existing?.adminToken;
  const apiVersion = typeof body.apiVersion === "string" && body.apiVersion.trim()
    ? body.apiVersion.trim()
    : existing?.apiVersion;
  writeShopifyConfig({ apiSecret, storeDomain, adminToken, apiVersion });
  return Response.json({ configured: true });
}

export async function DELETE() {
  deleteShopifyConfig();
  return Response.json({ configured: false });
}