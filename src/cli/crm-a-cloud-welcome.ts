import { spawn } from "node:child_process";
import process from "node:process";
import { isCancel, select } from "@clack/prompts";
import { stylePromptMessage } from "../terminal/prompt-style.js";
import { isRich, theme } from "../terminal/theme.js";
import { renderCrmACloudRecommendationBanner } from "./crm-a-cloud-banner.js";

export const CRM_A_LOGIN_URL = "https://dench.com/login";

async function openUrlInBrowser(url: string): Promise<boolean> {
  const [command, ...args] =
    process.platform === "darwin"
      ? ["open", url]
      : process.platform === "win32"
        ? ["cmd", "/c", "start", "", url]
        : ["xdg-open", url];
  return await new Promise<boolean>((resolve) => {
    const child = spawn(command, args, { stdio: "ignore", detached: true });
    child.once("error", () => resolve(false));
    child.once("spawn", () => {
      child.unref();
      resolve(true);
    });
  });
}

/**
 * The bare `npx crm-a-console` flow: show the Crm-A Cloud banner, offer a single
 * "Continue with Dench.com" action that opens dench.com/login, then end the
 * session. The full local setup lives under `npx crm-a-console bootstrap`.
 */
export async function runCrmACloudWelcome(): Promise<void> {
  const log = (line: string) => process.stdout.write(`${line}\n`);
  log(renderCrmACloudRecommendationBanner());

  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  if (!interactive) {
    log(`Continue with Dench.com: ${CRM_A_LOGIN_URL}`);
    return;
  }

  const choice = await select({
    message: stylePromptMessage("Get started with Crm-A Cloud"),
    options: [{ value: "continue", label: "Continue with Dench.com" }],
  });
  if (isCancel(choice)) {
    return;
  }

  const opened = await openUrlInBrowser(CRM_A_LOGIN_URL);
  const rich = isRich();
  const url = rich ? theme.accentBright(CRM_A_LOGIN_URL) : CRM_A_LOGIN_URL;
  log("");
  log(opened ? `  Opening ${url} in your browser…` : `  Open ${url} in your browser to continue.`);
  log("");
}
