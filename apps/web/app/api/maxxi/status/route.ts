/**
 * GET /api/maxxi/status — readiness checks for the presenter demo.
 *
 * Read-only and non-destructive: it reports whether identity, data, the demo
 * kill-switch, the optional AI provider and the governance queue are in the
 * expected state. It never exposes keys or personal data beyond aggregate
 * counts. Resetting the demo stays on POST /api/maxxi/seed (admin only).
 */

import { guardPermission, principalUsername } from "../_guard";
import { getDashboardKpis, listCampaigns, listSources } from "@/lib/maxxi/queries";
import { isDemoMode } from "@/lib/security/demo-mode";
import { chatApiKey, resolveChatModel } from "@/lib/maxxi/chat";
import {
  labelForRole,
  roleHasPermission,
  type OperatorRole,
} from "@/lib/security/rbac";
import { MAXXI_CLOCK_ISO, maxxiBackend, maxxiQuery, maxxiRun } from "@/lib/maxxi/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type CheckStatus = "ok" | "warn" | "bad";
type DemoCheck = { id: string; label: string; status: CheckStatus; detail: string };

export async function GET(req: Request) {
  const auth = guardPermission(req, "maxxi.view");
  if (!auth.ok) {return auth.response;}

  try {
    // maxxiRun parallelizes only on Quack; direct file access stays sequential
    // because DuckDB takes an exclusive lock per CLI process.
    const [kpis, sources, campaigns, reviewCounts] = await maxxiRun([
      () => getDashboardKpis(),
      () => listSources(),
      () => listCampaigns(),
      () => maxxiQuery<{
        candidates: number | string;
        decisions: number | string;
      }>(
        "SELECT (SELECT COUNT(*) FROM maxxi_review_candidate) AS candidates, " +
          "(SELECT COUNT(*) FROM maxxi_review_decision) AS decisions;",
      ),
    ]);
    const candidateCount = Number(reviewCounts[0]?.candidates ?? 0);
    const decisionCount = Number(reviewCounts[0]?.decisions ?? 0);

    const roles: OperatorRole[] =
      auth.principal.sub === "operator" ? auth.principal.roles : [];
    const canSeed =
      auth.principal.sub === "operator" && roleHasPermission(roles, "maxxi.seed");
    const people = Number(kpis.identifiedPeople ?? 0);
    const sourceCount = sources.length;
    const pending = Number(kpis.pendingReviews ?? 0);
    const drafts = campaigns.filter((campaign) => campaign.status === "draft").length;
    const approved = campaigns.filter((campaign) => campaign.status === "approved_simulated").length;
    const aiConfigured = Boolean(chatApiKey());
    const demoMode = isDemoMode();
    const backend = maxxiBackend();

    const checks: DemoCheck[] = [
      {
        id: "access",
        label: "Accesso operatore",
        status: "ok",
        detail:
          auth.principal.sub === "operator"
            ? `${principalUsername(auth.principal)} · ${roles.map(labelForRole).join(", ") || "senza ruolo"}`
            : "Principal di servizio (sola lettura + dry-run)",
      },
      {
        id: "data",
        label: "Dataset demo",
        status: people > 0 && sources.length > 0 ? "ok" : "bad",
        detail:
          people > 0
            ? `${people} persone · ${sourceCount} fonti · ${campaigns.length} campagne (${drafts} bozze, ${approved} approvate simulate) · backend ${backend === "quack" ? "Quack" : "file DuckDB"}`
            : "Nessun dato: un amministratore deve ricaricare la demo.",
      },
      {
        id: "outbound",
        label: "Invii esterni",
        status: demoMode ? "ok" : "bad",
        detail: demoMode
          ? "Bloccati dal kill-switch CRM_A_DEMO_MODE=1."
          : "Modalità demo spenta: il kill-switch NON è in forza.",
      },
      {
        id: "ai",
        label: "Provider AI",
        status: aiConfigured ? "ok" : "warn",
        detail: aiConfigured
          ? `Configurato (${resolveChatModel()}); la proposta resta una bozza da verificare.`
          : "Non configurato: la proposta userà il template deterministico verificato.",
      },
      {
        id: "governance",
        label: "Revisione identità",
        status: pending > 0 ? "warn" : "ok",
        detail:
          pending > 0
            ? `${pending} casi aperti su ${candidateCount} candidati · ${decisionCount} decisioni registrate.`
            : `Nessun caso aperto · ${decisionCount} decisioni registrate.`,
      },
    ];

    return Response.json({
      ok: true,
      generatedAt: new Date().toISOString(),
      clock: MAXXI_CLOCK_ISO,
      demoMode,
      backend,
      canSeed,
      role: roles.length > 0 ? roles.map(labelForRole).join(", ") : "Servizio",
      checks,
      counts: {
        people,
        sources: sourceCount,
        campaigns: campaigns.length,
        drafts,
        approved,
        pendingReviews: pending,
        reviewDecisions: decisionCount,
      },
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Status check failed." },
      { status: 500 },
    );
  }
}
