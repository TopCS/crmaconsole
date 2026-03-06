import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolveStateDir } from "../config/paths.js";

type TelemetryConfig = {
  enabled: boolean;
  noticeShown?: boolean;
  privacyMode?: boolean;
  anonymousId?: string;
};

const TELEMETRY_FILENAME = "telemetry.json";

function telemetryConfigPath(): string {
  return join(resolveStateDir(), TELEMETRY_FILENAME);
}

export function readTelemetryConfig(): TelemetryConfig {
  const configPath = telemetryConfigPath();
  try {
    if (!existsSync(configPath)) {
      return { enabled: true };
    }
    const raw = JSON.parse(readFileSync(configPath, "utf-8")) as Partial<TelemetryConfig>;
    return {
      enabled: raw.enabled !== false,
      noticeShown: raw.noticeShown === true,
      privacyMode: raw.privacyMode !== false,
      anonymousId: typeof raw.anonymousId === "string" ? raw.anonymousId : undefined,
    };
  } catch {
    return { enabled: true };
  }
}

export function writeTelemetryConfig(config: Partial<TelemetryConfig>): void {
  const configPath = telemetryConfigPath();
  const existing = readTelemetryConfig();
  const merged = { ...existing, ...config };
  try {
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, JSON.stringify(merged, null, 2) + "\n", "utf-8");
  } catch {
    // Non-fatal: telemetry config write failure should never crash the CLI.
  }
}

export function markNoticeShown(): void {
  writeTelemetryConfig({ noticeShown: true });
}

export function isPrivacyModeEnabled(): boolean {
  const config = readTelemetryConfig();
  return config.privacyMode !== false;
}

let _cachedAnonymousId: string | null = null;

/**
 * Return the persisted install-scoped anonymous ID from telemetry.json,
 * generating and writing one on first access.
 */
export function getOrCreateAnonymousId(): string {
  if (_cachedAnonymousId) return _cachedAnonymousId;

  const configPath = telemetryConfigPath();
  try {
    let raw: Record<string, unknown> = {};
    if (existsSync(configPath)) {
      raw = JSON.parse(readFileSync(configPath, "utf-8"));
    }
    if (typeof raw.anonymousId === "string" && raw.anonymousId) {
      _cachedAnonymousId = raw.anonymousId;
      return raw.anonymousId;
    }
    const id = randomUUID();
    raw.anonymousId = id;
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, JSON.stringify(raw, null, 2) + "\n", "utf-8");
    _cachedAnonymousId = id;
    return id;
  } catch {
    const id = randomUUID();
    _cachedAnonymousId = id;
    return id;
  }
}
