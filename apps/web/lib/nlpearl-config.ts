import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { resolveOpenClawStateDir } from "./workspace";

/**
 * NLPearl credential/store config, per workspace, at
 * `<stateDir>/.crm-a-nlpearl.json` (entered from the Integrations UI).
 * Env (`NLPEARL_ACCOUNT_ID`/`NLPEARL_SECRET_KEY`) wins when set — e.g. the
 * Docker compose — otherwise the config file is used.
 */

export type NlpearlConfig = {
  accountId: string;
  secretKey: string;
  /** Optional API base URL override (default https://api.nlpearl.ai/v2). */
  baseUrl?: string;
  /** Optional fixed voice ID (default: first Italian voice from NLPearl). */
  voiceId?: string;
};

function configPath(): string {
  return path.join(resolveOpenClawStateDir(), ".crm-a-nlpearl.json");
}

export function readNlpearlConfig(): NlpearlConfig | null {
  const filePath = configPath();
  if (!existsSync(filePath)) {return null;}
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf-8")) as Partial<NlpearlConfig>;
    if (
      typeof parsed.accountId === "string" && parsed.accountId.trim() &&
      typeof parsed.secretKey === "string" && parsed.secretKey.trim()
    ) {
      return {
        accountId: parsed.accountId.trim(),
        secretKey: parsed.secretKey.trim(),
        baseUrl: typeof parsed.baseUrl === "string" && parsed.baseUrl.trim()
          ? parsed.baseUrl.trim()
          : undefined,
        voiceId: typeof parsed.voiceId === "string" && parsed.voiceId.trim()
          ? parsed.voiceId.trim()
          : undefined,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function writeNlpearlConfig(config: NlpearlConfig): void {
  const filePath = configPath();
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(config, null, 2)}\n`, "utf-8");
}

export function deleteNlpearlConfig(): void {
  const filePath = configPath();
  if (existsSync(filePath)) {
    writeFileSync(filePath, "", "utf-8");
  }
}