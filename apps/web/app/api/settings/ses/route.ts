import { deleteSesConfig, readSesConfig, writeSesConfig, type SesConfig } from "@/lib/ses";
import { resolveAppPublicOrigin } from "@/lib/public-origin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET/POST/DELETE /api/settings/ses — manage the AWS SES transport config
 * (stored per workspace in .crm-a-ses.json). GET masks the secret and
 * includes the public SNS webhook URL for bounce/complaint wiring.
 */

export async function GET(req: Request) {
  const webhookUrl = `${resolveAppPublicOrigin(req)}/api/crm/campaigns/ses-webhook`;
  const config = readSesConfig();
  if (!config) {
    return Response.json({ configured: false, webhookUrl });
  }
  return Response.json({
    configured: true,
    region: config.region,
    fromEmail: config.fromEmail,
    fromName: config.fromName ?? "",
    configurationSet: config.configurationSet ?? "",
    accessKeyId: config.accessKeyId,
    secretAccessKeyMasked: `••••${config.secretAccessKey.slice(-4)}`,
    webhookUrl,
  });
}

export async function POST(req: Request) {
  let body: Partial<SesConfig>;
  try {
    body = (await req.json()) as Partial<SesConfig>;
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const existing = readSesConfig();
  const config: SesConfig = {
    region: body.region?.trim() || existing?.region || "",
    accessKeyId: body.accessKeyId?.trim() || existing?.accessKeyId || "",
    secretAccessKey: body.secretAccessKey?.trim() || existing?.secretAccessKey || "",
    fromEmail: body.fromEmail?.trim() || existing?.fromEmail || "",
    fromName: body.fromName?.trim() || undefined,
    configurationSet: body.configurationSet?.trim() || undefined,
  };
  if (!config.region || !config.accessKeyId || !config.secretAccessKey || !config.fromEmail) {
    return Response.json(
      { error: "region, accessKeyId, secretAccessKey and fromEmail are required." },
      { status: 400 },
    );
  }
  writeSesConfig(config);
  return Response.json({ configured: true });
}

export async function DELETE() {
  deleteSesConfig();
  return Response.json({ configured: false });
}
