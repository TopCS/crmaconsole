import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolveStateDir } from "../config/paths.js";

type TelemetryConfig = {
  enabled: boolean;
  noticeShown?: boolean;
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
