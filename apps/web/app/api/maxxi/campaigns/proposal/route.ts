/** POST /api/maxxi/campaigns/proposal — AI proposal, never saved nor sent. */

import { guardPermission } from "../../_guard";
import { evaluateArchRenewal45d, listCatalog } from "@/lib/maxxi/queries";
import { generateCampaignProposal } from "@/lib/maxxi/campaign-proposal";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const auth = guardPermission(req, "maxxi.campaigns.create");
  if (!auth.ok) {return auth.response;}

  const [segment, catalog] = await Promise.all([evaluateArchRenewal45d(), listCatalog()]);
  const proposal = await generateCampaignProposal({ segment, catalog });
  return Response.json({ ok: true, proposal });
}
