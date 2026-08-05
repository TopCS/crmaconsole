import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { resolveOpenClawStateDir } from "./workspace";

/**
 * AWS SES transport for campaign sending. Config is stored per workspace in
 * `<stateDir>/.crm-a-ses.json` (entered from the Integrations UI). The SES
 * identity (domain/from address) must be verified in AWS beforehand.
 */

export type SesConfig = {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  fromEmail: string;
  fromName?: string;
  /** Optional SES configuration set name (enables event publishing/SNS). */
  configurationSet?: string;
};

function configPath(): string {
  return path.join(resolveOpenClawStateDir(), ".crm-a-ses.json");
}

export function readSesConfig(): SesConfig | null {
  const filePath = configPath();
  if (!existsSync(filePath)) {return null;}
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf-8")) as Partial<SesConfig>;
    if (
      typeof parsed.region === "string" && parsed.region.trim() &&
      typeof parsed.accessKeyId === "string" && parsed.accessKeyId.trim() &&
      typeof parsed.secretAccessKey === "string" && parsed.secretAccessKey.trim() &&
      typeof parsed.fromEmail === "string" && parsed.fromEmail.trim()
    ) {
      return {
        region: parsed.region.trim(),
        accessKeyId: parsed.accessKeyId.trim(),
        secretAccessKey: parsed.secretAccessKey.trim(),
        fromEmail: parsed.fromEmail.trim(),
        fromName: typeof parsed.fromName === "string" ? parsed.fromName.trim() : undefined,
        configurationSet:
          typeof parsed.configurationSet === "string" && parsed.configurationSet.trim()
            ? parsed.configurationSet.trim()
            : undefined,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function writeSesConfig(config: SesConfig): void {
  const filePath = configPath();
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(config, null, 2)}\n`, "utf-8");
}

export function deleteSesConfig(): void {
  const filePath = configPath();
  if (existsSync(filePath)) {
    writeFileSync(filePath, "{}\n", "utf-8");
  }
}

export function isSesConfigured(): boolean {
  return readSesConfig() !== null;
}

let cachedClient: { key: string; client: SESv2Client } | null = null;

function sesClient(config: SesConfig): SESv2Client {
  const key = `${config.region}:${config.accessKeyId}`;
  if (cachedClient && cachedClient.key === key) {return cachedClient.client;}
  const client = new SESv2Client({
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
  cachedClient = { key, client };
  return client;
}

/**
 * Send a single plain-text email via SES. Returns the SES message id
 * (used to correlate bounce/complaint notifications).
 */
export async function sendSesEmail(params: {
  to: string;
  subject: string;
  body: string;
}): Promise<{ messageId: string }> {
  const config = readSesConfig();
  if (!config) {
    throw new Error("AWS SES is not configured.");
  }
  const from = config.fromName
    ? `${config.fromName.replace(/[<>"]/g, "")} <${config.fromEmail}>`
    : config.fromEmail;

  const result = await sesClient(config).send(
    new SendEmailCommand({
      FromEmailAddress: from,
      Destination: { ToAddresses: [params.to] },
      Content: {
        Simple: {
          Subject: { Data: params.subject, Charset: "UTF-8" },
          Body: { Text: { Data: params.body, Charset: "UTF-8" } },
        },
      },
      ...(config.configurationSet
        ? { ConfigurationSetName: config.configurationSet }
        : {}),
    }),
  );
  return { messageId: result.MessageId ?? "" };
}
