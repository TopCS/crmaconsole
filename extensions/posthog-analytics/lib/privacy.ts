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

/**
 * Redact a tool_calls array while preserving tool name, id, and type metadata.
 * Only arguments are redacted.
 */
function redactToolCalls(toolCalls: unknown[]): unknown[] {
  return toolCalls.map((tc: any) => {
    if (!tc || typeof tc !== "object") return tc;
    const out: Record<string, unknown> = {
      id: tc.id,
      type: tc.type ?? "function",
    };
    if (tc.function && typeof tc.function === "object") {
      out.function = {
        name: tc.function.name,
        arguments: REDACTED,
      };
    }
    if (tc.name) out.name = tc.name;
    return out;
  });
}

/**
 * Redact Anthropic-format content blocks while preserving tool metadata.
 * Text blocks get redacted; toolCall blocks keep their name but redact arguments.
 */
function redactContentBlocks(blocks: unknown[]): unknown[] {
  return blocks.map((block: any) => {
    if (!block || typeof block !== "object") return block;
    if (block.type === "text") {
      return { type: "text", text: REDACTED };
    }
    if (block.type === "toolCall") {
      return {
        type: "toolCall",
        id: block.id ?? block.toolCallId,
        name: block.name,
        arguments: REDACTED,
      };
    }
    if (block.type === "tool_use") {
      return {
        type: "tool_use",
        id: block.id,
        name: block.name,
        input: REDACTED,
      };
    }
    if (block.type === "thinking") {
      return { type: "thinking", text: REDACTED };
    }
    return { type: block.type };
  });
}

/**
 * Structure-preserving message redaction for PostHog message-array fields.
 * Preserves: role, tool names, tool_call IDs, message ordering, tool types.
 * Redacts: text content, tool arguments, tool results.
 */
export function redactMessagesStructured(messages: unknown): unknown {
  if (!Array.isArray(messages)) return messages;
  return messages.map((msg: any) => {
    if (!msg || typeof msg !== "object") return msg;
    const out: Record<string, unknown> = { role: msg.role };

    if (msg.name) out.name = msg.name;
    if (msg.tool_call_id) out.tool_call_id = msg.tool_call_id;
    if (msg.toolCallId) out.toolCallId = msg.toolCallId;
    if (msg.toolName) out.toolName = msg.toolName;
    if (msg.isError != null) out.isError = msg.isError;
    if (msg.stopReason) out.stopReason = msg.stopReason;
    if (msg.model) out.model = msg.model;
    if (msg.provider) out.provider = msg.provider;

    if (Array.isArray(msg.content)) {
      out.content = redactContentBlocks(msg.content);
    } else {
      out.content = REDACTED;
    }

    if (Array.isArray(msg.tool_calls)) {
      out.tool_calls = redactToolCalls(msg.tool_calls);
    }

    return out;
  });
}

/**
 * Structure-preserving redaction for normalized OpenAI-format output choices.
 * Keeps role, tool_calls[].function.name, tool_calls[].type.
 * Redacts text content and tool arguments.
 */
export function redactOutputChoicesStructured(choices: unknown): unknown {
  if (!Array.isArray(choices)) return choices;
  return choices.map((choice: any) => {
    if (!choice || typeof choice !== "object") return choice;
    const out: Record<string, unknown> = {
      role: choice.role,
      content: choice.content != null ? REDACTED : null,
    };
    if (Array.isArray(choice.tool_calls)) {
      out.tool_calls = redactToolCalls(choice.tool_calls);
    }
    return out;
  });
}

/**
 * Sanitize messages for PostHog capture, preserving structure in privacy mode.
 * Privacy on: redacts text content/arguments but keeps role, tool names, ordering.
 * Privacy off: only strips credential patterns.
 */
export function sanitizeMessages(
  messages: unknown,
  privacyMode: boolean,
): unknown {
  if (privacyMode) return redactMessagesStructured(messages);
  return stripSecrets(messages);
}

/**
 * Sanitize normalized output choices for PostHog capture, preserving structure.
 * Privacy on: redacts text content/arguments but keeps role, tool names.
 * Privacy off: only strips credential patterns.
 */
export function sanitizeOutputChoices(
  choices: unknown,
  privacyMode: boolean,
): unknown {
  if (privacyMode) return redactOutputChoicesStructured(choices);
  return stripSecrets(choices);
}
