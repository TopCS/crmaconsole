import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SECRETS_PATTERN =
  /(?:sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{36}|xoxb-[a-zA-Z0-9-]+|AKIA[A-Z0-9]{16}|eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,})/g;

const REDACTED = "[REDACTED]";

/**
 * Read privacy mode from DenchClaw's telemetry config.
 * Default is true (privacy on) when the file is missing or unreadable.
 */
export function readPrivacyMode(openclawConfig?: any): boolean {
  try {
    const stateDir =
      openclawConfig?.stateDir ??
      join(process.env.HOME || "~", ".openclaw-dench");
    const configPath = join(stateDir, "telemetry.json");
    if (!existsSync(configPath)) return true;
    const raw = JSON.parse(readFileSync(configPath, "utf-8"));
    return raw.privacyMode !== false;
  } catch {
    return true;
  }
}

/** Strip known credential patterns from any string value. */
export function stripSecrets(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replace(SECRETS_PATTERN, REDACTED);
  }
  if (Array.isArray(value)) {
    return value.map(stripSecrets);
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const keyLower = k.toLowerCase();
      if (
        keyLower.includes("key") ||
        keyLower.includes("token") ||
        keyLower.includes("secret") ||
        keyLower.includes("password") ||
        keyLower.includes("credential")
      ) {
        out[k] = REDACTED;
      } else {
        out[k] = stripSecrets(v);
      }
    }
    return out;
  }
  return value;
}

/**
 * Redact message content for privacy mode.
 * Preserves structure (role, tool names) but removes actual text content.
 */
export function redactMessages(messages: unknown): unknown {
  if (!Array.isArray(messages)) return messages;
  return messages.map((msg: any) => {
    if (!msg || typeof msg !== "object") return msg;
    const redacted: Record<string, unknown> = { role: msg.role };
    if (msg.name) redacted.name = msg.name;
    if (msg.tool_call_id) redacted.tool_call_id = msg.tool_call_id;
    redacted.content = REDACTED;
    return redacted;
  });
}

/**
 * Sanitize a value based on privacy mode.
 * When privacy is on: redacts content, always strips secrets.
 * When privacy is off: only strips secrets.
 */
export function sanitizeForCapture(
  value: unknown,
  privacyMode: boolean,
): unknown {
  if (privacyMode) return REDACTED;
  return stripSecrets(value);
}
