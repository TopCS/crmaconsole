import {
  readNlpearlConfig,
  writeNlpearlConfig,
  deleteNlpearlConfig,
} from "@/lib/nlpearl-config";
import { buildNlpearlCallbackUrls } from "@/lib/nlpearl";
import { readPhoneWebhookSecret } from "@/lib/phone-webhook";
import { resolveAppPublicOrigin } from "@/lib/public-origin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET/POST/DELETE /api/settings/nlpearl — manage the NLPearl phone transport
 * config (stored per workspace in .crm-a-nlpearl.json). GET masks the secret,
 * reports the env/config source and the callback URLs to configure on the
 * Pearl. Env vars win for auth at runtime; the UI writes the config file.
 */

export async function GET(req: Request) {
  const origin = resolveAppPublicOrigin(req);
  const token = readPhoneWebhookSecret() ?? undefined;
  const urls = buildNlpearlCallbackUrls(origin, token);

  const cfg = readNlpearlConfig();
  const envAccount = process.env.NLPEARL_ACCOUNT_ID?.trim();
  const envSecret = process.env.NLPEARL_SECRET_KEY?.trim();

  if (envAccount && envSecret) {
    return Response.json({
      configured: true,
      source: "env",
      accountId: envAccount,
      secretKeyMasked: `••••${envSecret.slice(-4)}`,
      baseUrl: process.env.NLPEARL_BASE_URL?.trim() ?? undefined,
      callWebhookUrl: urls.callWebhookUrl,
      leadWebhookUrl: urls.leadWebhookUrl,
    });
  }
  if (!cfg) {
    return Response.json({ configured: false, ...urls });
  }
  return Response.json({
    configured: true,
    source: "config",
    accountId: cfg.accountId,
    secretKeyMasked: `••••${cfg.secretKey.slice(-4)}`,
    baseUrl: cfg.baseUrl,
    voiceId: cfg.voiceId,
    callWebhookUrl: urls.callWebhookUrl,
    leadWebhookUrl: urls.leadWebhookUrl,
  });
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const existing = readNlpearlConfig();
  const accountId = typeof body.accountId === "string" ? body.accountId.trim() : "";
  const secretKey = typeof body.secretKey === "string" ? body.secretKey.trim() : "";
  const baseUrl = typeof body.baseUrl === "string" ? body.baseUrl.trim() : undefined;
  const voiceId = typeof body.voiceId === "string" ? body.voiceId.trim() : undefined;

  if (!accountId || !secretKey) {
    return Response.json(
      { error: "accountId and secretKey are required." },
      { status: 400 },
    );
  }
  writeNlpearlConfig({ accountId, secretKey, baseUrl, voiceId: voiceId || existing?.voiceId });
  return Response.json({ configured: true });
}

export async function DELETE() {
  deleteNlpearlConfig();
  return Response.json({ configured: false });
}