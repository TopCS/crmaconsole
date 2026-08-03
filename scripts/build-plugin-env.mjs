import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const key = process.env.POSTHOG_KEY || "";

const rootPkg = JSON.parse(readFileSync("package.json", "utf-8"));
const crmAConsoleVersion = rootPkg.version || "";

let openclawVersion = "";
try {
  const req = createRequire(import.meta.url);
  const oclPkg = req("openclaw/package.json");
  openclawVersion = oclPkg.version || "";
} catch {
  /* openclaw not resolvable at build time */
}

writeFileSync(
  "extensions/posthog-analytics/lib/build-env.js",
  [
    `export const POSTHOG_KEY = ${JSON.stringify(key)};`,
    `export const CRM_A_CONSOLE_VERSION = ${JSON.stringify(crmAConsoleVersion)};`,
    `export const OPENCLAW_VERSION = ${JSON.stringify(openclawVersion)};`,
    "",
  ].join("\n"),
);
