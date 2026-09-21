/**
 * Shared bridge from a plugin (running inside the Gateway) to the managed
 * Crm-A Console web runtime.
 *
 * Plugins that must call the console's own HTTP API (campaign routes, segment
 * upsert, …) need the same two things: the web runtime base URL and the
 * internal bearer secret. Keeping this in `extensions/shared` means one
 * implementation — a per-plugin copy drifts the moment the port or the secret
 * env name changes.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const DEFAULT_WEB_PORT = 3100;
const PROCESS_JSON_REL = path.join("web-runtime", "process.json");

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** State dir of the profile this plugin runs under (`OPENCLAW_STATE_DIR` wins). */
export function resolveConsoleStateDir(): string {
  const fromEnv = readString(process.env.OPENCLAW_STATE_DIR);
  if (fromEnv) {
    return fromEnv;
  }
  const home = readString(process.env.HOME) ?? "/root";
  return path.join(home, ".openclaw-crm-a");
}

function resolvePortFromProcessFile(stateDir: string): number | undefined {
  try {
    const file = path.join(stateDir, PROCESS_JSON_REL);
    if (!existsSync(file)) {
      return undefined;
    }
    const parsed = asRecord(JSON.parse(readFileSync(file, "utf-8")));
    return readNumber(parsed?.port);
  } catch {
    return undefined;
  }
}

/** Base URL of the managed web runtime (env override → process.json → 3100). */
export function resolveConsoleWebBaseUrl(): string {
  const fromEnv = readString(process.env.CRM_A_CONSOLE_WEB_BASE_URL);
  if (fromEnv) {
    return fromEnv.replace(/\/$/, "");
  }
  const port = resolvePortFromProcessFile(resolveConsoleStateDir()) ?? DEFAULT_WEB_PORT;
  return `http://127.0.0.1:${port}`;
}

/** Internal bearer secret shared with the web runtime. */
export function readConsoleWebSecret(): string | undefined {
  return readString(process.env.CRM_A_PHONE_WEBHOOK_SECRET);
}

/** POST JSON to a console route, returning the parsed body (never throws). */
export async function postConsoleJson(
  pathName: string,
  body: unknown,
  timeoutMs = 30_000,
): Promise<{ status: number; body: UnknownRecord }> {
  const secret = readConsoleWebSecret();
  if (!secret) {
    return { status: 0, body: { error: "CRM_A_PHONE_WEBHOOK_SECRET not set; console API unavailable." } };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${resolveConsoleWebBaseUrl()}${pathName}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify(body ?? {}),
      signal: controller.signal,
    });
    const text = await res.text();
    let parsed: UnknownRecord = {};
    if (text.trim()) {
      try {
        parsed = asRecord(JSON.parse(text)) ?? { error: text.slice(0, 300) };
      } catch {
        parsed = { error: text.slice(0, 300) };
      }
    }
    return { status: res.status, body: parsed };
  } catch (err) {
    return {
      status: 0,
      body: { error: err instanceof Error ? err.message : String(err) },
    };
  } finally {
    clearTimeout(timer);
  }
}
