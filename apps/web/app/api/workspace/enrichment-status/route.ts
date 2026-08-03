import { getIntegrationsState } from "@/lib/integrations";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/workspace/enrichment-status
 * Returns whether Apollo enrichment is available and, if not, why.
 */
export async function GET() {
	const state = getIntegrationsState();

	if (!state.crmACloud.isPrimaryProvider) {
		return Response.json({
			available: false,
			reason: "Crm-A Cloud is not the active provider.",
		});
	}

	if (!state.crmACloud.hasKey) {
		return Response.json({
			available: false,
			reason: "No Crm-A Cloud API key configured.",
		});
	}

	const apollo = state.integrations.find((i) => i.id === "apollo");
	if (!apollo || !apollo.enabled) {
		return Response.json({
			available: false,
			reason: "Apollo integration is not enabled.",
		});
	}

	return Response.json({ available: true });
}
