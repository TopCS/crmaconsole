/**
 * Web-side mirror of `extensions/shared/crm-a-auth.ts#readCrmAAuthProfileKey`.
 *
 * Reads the Crm-A Cloud API key from the same single source of truth
 * (`<stateDir>/agents/main/agent/auth-profiles.json#profiles["crm-a-cloud:default"].key`)
 * that the OpenClaw gateway and bundled plugins use, with the same
 * env-var fallback. Kept as a separate file (rather than importing from
 * `../../extensions/shared/crm-a-auth.ts`) so the Next.js bundler
 * doesn't have to reach across the workspace boundary.
 *
 * Used by the loopback `/api/sync/poll-tick` endpoint to validate the
 * Bearer token sent by the `crm-a-ai-gateway` plugin's sync trigger.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolveOpenClawStateDir } from "@/lib/workspace";

const AUTH_PROFILES_REL = join("agents", "main", "agent", "auth-profiles.json");

type UnknownRecord = Record<string, unknown>;

function readKeyFromAuthProfiles(authPath: string): string | undefined {
  try {
    if (!existsSync(authPath)) {
      return undefined;
    }
    const raw = JSON.parse(readFileSync(authPath, "utf-8")) as UnknownRecord;
    const profiles = (raw?.profiles as UnknownRecord | undefined) ?? undefined;
    const profile = (profiles?.["crm-a-cloud:default"] as UnknownRecord | undefined) ?? undefined;
    const key = profile?.key;
    return typeof key === "string" && key.trim() ? key.trim() : undefined;
  } catch {
    return undefined;
  }
}

function authProfilesPath(): string {
  return join(resolveOpenClawStateDir(), AUTH_PROFILES_REL);
}

function envFallback(): string | undefined {
  return (
    process.env.CRM_A_CLOUD_API_KEY?.trim() ||
    process.env.CRM_A_API_KEY?.trim() ||
    undefined
  );
}

export function readCrmAAuthProfileKey(): string | undefined {
  const key = readKeyFromAuthProfiles(authProfilesPath());
  if (key) {
    return key;
  }
  return envFallback();
}

export function writeCrmAAuthProfileKey(apiKey: string): void {
  const authPath = authProfilesPath();
  let raw: UnknownRecord = { version: 1, profiles: {} };

  if (existsSync(authPath)) {
    try {
      const parsed = JSON.parse(readFileSync(authPath, "utf-8")) as UnknownRecord;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        raw = parsed;
      }
    } catch {
      // Fall through to a fresh auth profile if the file is unreadable.
    }
  }

  const profiles =
    raw.profiles && typeof raw.profiles === "object" && !Array.isArray(raw.profiles)
      ? (raw.profiles as UnknownRecord)
      : {};

  profiles["crm-a-cloud:default"] = {
    type: "api_key",
    provider: "crm-a-cloud",
    key: apiKey,
  };
  raw.profiles = profiles;
  if (raw.version !== 1) {
    raw.version = 1;
  }

  mkdirSync(dirname(authPath), { recursive: true });
  writeFileSync(authPath, JSON.stringify(raw, null, 2) + "\n", "utf-8");
}
