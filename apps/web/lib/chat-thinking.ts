import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveOpenClawStateDir } from "./workspace";
import {
	DEFAULT_CHAT_THINKING_LEVEL,
	isChatThinkingLevel,
	type ChatThinkingLevel,
} from "./chat-models";

export {
	CHAT_THINKING_LEVELS,
	DEFAULT_CHAT_THINKING_LEVEL,
	isChatThinkingLevel,
	type ChatThinkingLevel,
} from "./chat-models";

/**
 * Resolve the configured chat thinking level from openclaw.json
 * (`agents.defaults.thinkingDefault`). Falls back to
 * DEFAULT_CHAT_THINKING_LEVEL when unset or invalid.
 *
 * Server-only: reads from disk, so client components must import the
 * constants from ./chat-models instead.
 */
export function readConfiguredChatThinkingLevel(): ChatThinkingLevel {
	try {
		const raw = JSON.parse(
			readFileSync(join(resolveOpenClawStateDir(), "openclaw.json"), "utf-8"),
		) as unknown;
		const value = (raw as { agents?: { defaults?: { thinkingDefault?: unknown } } })
			?.agents?.defaults?.thinkingDefault;
		return isChatThinkingLevel(value) ? value : DEFAULT_CHAT_THINKING_LEVEL;
	} catch {
		return DEFAULT_CHAT_THINKING_LEVEL;
	}
}
