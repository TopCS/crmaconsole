/**
 * OpenRouter public catalog fetch for the on-premise model picker.
 * The endpoint is public (no auth required to LIST models); the key is only
 * needed to USE them, so availability is decided by the caller.
 */

export type OpenRouterCatalogModel = {
	/** Full config value, e.g. "openrouter/deepseek/deepseek-v4-pro". */
	configValue: string;
	/** OpenRouter model id without the provider prefix, e.g. "deepseek/deepseek-v4-pro". */
	id: string;
	displayName: string;
	provider: "openrouter";
	reasoning: boolean;
};

type OpenRouterCatalogEntry = {
	id?: unknown;
	name?: unknown;
	supported_parameters?: unknown;
};

type OpenRouterCatalogResponse = {
	data?: OpenRouterCatalogEntry[];
};

const CATALOG_TTL_MS = 10 * 60_000;

let cache: { at: number; models: OpenRouterCatalogModel[] } | null = null;

function asString(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isReasoning(entry: OpenRouterCatalogEntry): boolean {
	const params = entry.supported_parameters;
	if (!Array.isArray(params)) {
		return false;
	}
	return params.some(
		(p) => p === "reasoning" || p === "include_reasoning" || p === "thinking",
	);
}

export async function fetchOpenRouterCatalog(
	fetchImpl: typeof fetch = fetch,
): Promise<OpenRouterCatalogModel[]> {
	if (cache && Date.now() - cache.at < CATALOG_TTL_MS) {
		return cache.models;
	}

	try {
		const res = await fetchImpl("https://openrouter.ai/api/v1/models", {
			headers: { Accept: "application/json" },
			signal: AbortSignal.timeout(15_000),
		});
		if (!res.ok) {
			return cache?.models ?? [];
		}
		const payload = (await res.json()) as OpenRouterCatalogResponse;
		const entries = Array.isArray(payload.data) ? payload.data : [];
		const models: OpenRouterCatalogModel[] = [];
		for (const entry of entries) {
			const id = asString(entry.id);
			if (!id || id.includes(" ")) {
				continue;
			}
			const name = asString(entry.name) ?? id;
			models.push({
				configValue: `openrouter/${id}`,
				id,
				displayName: name,
				provider: "openrouter",
				reasoning: isReasoning(entry),
			});
		}
		models.sort((a, b) => a.displayName.localeCompare(b.displayName));
		cache = { at: Date.now(), models };
		return models;
	} catch {
		// Offline / blocked: keep serving the last good list if we have one.
		return cache?.models ?? [];
	}
}

/** Test-only: drop the in-memory catalog cache. */
export function resetOpenRouterCatalogCache(): void {
	cache = null;
}
