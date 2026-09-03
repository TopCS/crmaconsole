import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { resolveOpenClawStateDir } from "./workspace";

/**
 * Agent primary model management (agents.defaults.model.primary).
 *
 * Unlike the Crm-A Cloud selector, this accepts any provider-prefixed
 * model id the gateway understands (e.g. `openrouter/deepseek/deepseek-v4-pro`),
 * which is how on-premise installs without a Crm-A Cloud key configure their
 * primary chat model.
 */

const MODEL_CONFIG_RE = /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._/-]*$/i;

export function readPrimaryModel(config: Record<string, unknown>): string | null {
	const modelValue = (config.agents as { defaults?: { model?: unknown } } | undefined)
		?.defaults?.model;
	if (typeof modelValue === "string") {
		return modelValue.trim() || null;
	}
	const primary = (modelValue as { primary?: unknown } | undefined)?.primary;
	return typeof primary === "string" && primary.trim() ? primary.trim() : null;
}

function readConfig(): Record<string, unknown> {
	const fp = join(resolveOpenClawStateDir(), "openclaw.json");
	if (!existsSync(fp)) {
		return {};
	}
	try {
		return JSON.parse(readFileSync(fp, "utf-8")) as Record<string, unknown>;
	} catch {
		return {};
	}
}

function writeConfig(config: Record<string, unknown>): void {
	const fp = join(resolveOpenClawStateDir(), "openclaw.json");
	writeFileSync(fp, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

export function isValidPrimaryModel(model: string): boolean {
	return MODEL_CONFIG_RE.test(model.trim()) && !model.trim().endsWith("/");
}

/** Persist the primary agent model. Caller decides whether to restart the gateway. */
export function setPrimaryModel(model: string): { changed: boolean; model: string } {
	const normalized = model.trim();
	if (!isValidPrimaryModel(normalized)) {
		throw new Error(`Invalid model id '${model}'. Expected 'provider/model-id'.`);
	}
	const config = readConfig();
	const primaryChanged = readPrimaryModel(config) !== normalized;

	const agents = (config.agents ?? {}) as Record<string, unknown>;
	const defaults = (agents.defaults ?? {}) as Record<string, unknown>;
	// Extend the per-agent model allowlist — the gateway validates
	// sessions.patch.model against it ("model not allowed" otherwise).
	const allowlist = (defaults.models ?? {}) as Record<string, unknown>;
	const allowlistChanged = !(normalized in allowlist);
	if (allowlistChanged) {
		allowlist[normalized] = {};
		defaults.models = allowlist;
	}

	if (primaryChanged) {
		const modelSetting = (defaults.model ?? {}) as Record<string, unknown>;
		if (Object.keys(modelSetting).length > 0) {
			modelSetting.primary = normalized;
			defaults.model = modelSetting;
		} else {
			// No existing model block: store the flat string form, matching the
			// gateway's accepted shorthand.
			defaults.model = normalized;
		}
	}

	if (!primaryChanged && !allowlistChanged) {
		return { changed: false, model: normalized };
	}
	agents.defaults = defaults;
	config.agents = agents;
	writeConfig(config);
	return { changed: true, model: normalized };
}

export function readCurrentPrimaryModel(): string | null {
	return readPrimaryModel(readConfig());
}
