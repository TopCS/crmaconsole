import { readCurrentPrimaryModel } from "@/lib/agent-model";
import { fetchOpenRouterCatalog } from "@/lib/openrouter-models";
import { readConfiguredChatThinkingLevel } from "@/lib/chat-thinking";
import {
	fetchCrmACloudCatalog,
	readConfiguredCrmACloudSettings,
} from "@/lib/crm-a-cloud-settings";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveOpenClawStateDir } from "@/lib/workspace";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Aggregated model catalog for the chat header picker.
 *
 * Serves both providers an on-premise install may use:
 * - Crm-A Cloud (only when an API key is configured)
 * - OpenRouter (when OPENROUTER_API_KEY is set in the env or config)
 */

type CatalogModel = {
	configValue: string;
	stableId: string;
	displayName: string;
	provider: string;
	reasoning: boolean;
};

const CRM_CATALOG_TTL_MS = 10 * 60_000;
let crmCatalogCache: { at: number; models: CatalogModel[] } | null = null;

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

async function crmACloudCatalog(): Promise<CatalogModel[]> {
	const settings = readConfiguredCrmACloudSettings(readConfig());
	if (!settings.gatewayUrl || !settings.apiKey) {
		return [];
	}
	if (crmCatalogCache && Date.now() - crmCatalogCache.at < CRM_CATALOG_TTL_MS) {
		return crmCatalogCache.models;
	}
	try {
		const catalog = await fetchCrmACloudCatalog(settings.gatewayUrl);
		const models: CatalogModel[] = catalog.models.map((m) => ({
			configValue: `crm-a-cloud/${m.stableId}`,
			stableId: m.stableId,
			displayName: m.displayName,
			provider: m.provider,
			reasoning: Boolean(m.reasoning),
		}));
		crmCatalogCache = { at: Date.now(), models };
		return models;
	} catch {
		return crmCatalogCache?.models ?? [];
	}
}

export async function GET() {
	const openrouterAvailable =
		Boolean(process.env.OPENROUTER_API_KEY?.trim()) || readConfiguredOpenRouterKeyFromConfig();

	const [openrouterModels, crmModels] = await Promise.all([
		openrouterAvailable ? fetchOpenRouterCatalog() : Promise.resolve([]),
		crmACloudCatalog(),
	]);

	return Response.json({
		primaryModel: readCurrentPrimaryModel(),
		thinkingLevel: readConfiguredChatThinkingLevel(),
		providers: {
			openrouter: { available: openrouterAvailable, models: openrouterModels },
			crmACloud: { available: crmModels.length > 0, models: crmModels },
		},
	});
}

function readConfiguredOpenRouterKeyFromConfig(): boolean {
	const provider = readConfig().models as
		| { providers?: Record<string, { apiKey?: unknown }> }
		| undefined;
	const entry = provider?.providers?.openrouter;
	return typeof entry?.apiKey === "string" && entry.apiKey.trim().length > 0;
}
