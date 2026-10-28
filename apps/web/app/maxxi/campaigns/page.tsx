"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Card, DemoNote, Empty, ErrorNote, SectionTitle } from "../ui";

type Campaign = {
	campaignId: string;
	segmentId: string;
	subject: string;
	body: string;
	createdBy: string;
	status: string;
	deliveryMode: string;
	createdAt: string;
};

type AuditRow = {
	auditId: string;
	principalId: string;
	action: string;
	targetId: string;
	requestedAt: string;
	approvedAt: string | null;
	status: string;
};

export default function CampaignsPage() {
	const [campaigns, setCampaigns] = useState<Campaign[]>([]);
	const [audit, setAudit] = useState<AuditRow[]>([]);
	const [demoMode, setDemoMode] = useState<boolean | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState<string | null>(null);

	const load = useCallback(async () => {
		setError(null);
		try {
			const res = await fetch("/api/maxxi/campaigns", { cache: "no-store" });
			const body = (await res.json()) as { campaigns?: Campaign[]; audit?: AuditRow[]; demoMode?: boolean; error?: string };
			if (!res.ok) {throw new Error(body.error ?? `HTTP ${res.status}`);}
			setCampaigns(body.campaigns ?? []);
			setAudit(body.audit ?? []);
			setDemoMode(Boolean(body.demoMode));
		} catch (err) {
			setError(err instanceof Error ? err.message : "Caricamento fallito.");
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	async function approve(campaignId: string) {
		setBusy(campaignId);
		try {
			const res = await fetch(
				`/api/maxxi/campaigns?action=approve&id=${encodeURIComponent(campaignId)}`,
				{ method: "POST" },
			);
			const body = (await res.json()) as { error?: string };
			if (!res.ok) {throw new Error(body.error ?? `HTTP ${res.status}`);}
			await load();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Approvazione fallita.");
		} finally {
			setBusy(null);
		}
	}

	return (
		<div className="space-y-4">
			<SectionTitle hint="Composizione, anteprima e approvazione simulata — nessun invio">
				Campagne
			</SectionTitle>

			{error && <ErrorNote>{error}</ErrorNote>}
			{demoMode === false && (
				<Card>
					<Badge tone="bad">demo mode spento</Badge>
					<p className="mt-2 text-xs" style={{ color: "var(--color-text-muted)" }}>
						CRM_A_DEMO_MODE non è attivo: il kill-switch degli invii non è in forza. Per la demo va impostato a 1.
					</p>
				</Card>
			)}

			<Card>
				<SectionTitle hint="Solo bozze: il delivery resta dry_run">Bozze</SectionTitle>
				{campaigns.length === 0 ? (
					<Empty>Nessuna bozza. Creala dal segmento.</Empty>
				) : (
					<ul className="space-y-3">
						{campaigns.map((campaign) => (
							<li key={campaign.campaignId} className="rounded-lg border p-3" style={{ borderColor: "var(--color-border)" }}>
								<div className="flex flex-wrap items-center justify-between gap-2">
									<span className="text-sm font-medium" style={{ color: "var(--color-text)" }}>{campaign.subject}</span>
									<span className="flex items-center gap-2">
										<Badge tone={campaign.status === "approved_simulated" ? "ok" : "neutral"}>{campaign.status}</Badge>
										<Badge tone="warn">{campaign.deliveryMode}</Badge>
									</span>
								</div>
								<p className="mt-1 text-xs" style={{ color: "var(--color-text-muted)" }}>{campaign.body}</p>
								<div className="mt-2 flex flex-wrap items-center justify-between gap-2">
									<span className="text-[11px]" style={{ color: "var(--color-text-muted)" }}>
										{campaign.campaignId} · segmento {campaign.segmentId} · {campaign.createdAt.slice(0, 16).replace("T", " ")}
									</span>
									{campaign.status !== "approved_simulated" && (
										<button
											type="button"
											onClick={() => approve(campaign.campaignId)}
											disabled={busy === campaign.campaignId}
											className="rounded-lg border px-2.5 py-1 text-xs font-medium disabled:opacity-60"
											style={{ borderColor: "var(--color-border)", color: "var(--color-text)" }}
										>
											{busy === campaign.campaignId ? "…" : "Simula approvazione"}
										</button>
									)}
								</div>
							</li>
						))}
					</ul>
				)}
			</Card>

			<Card>
				<SectionTitle hint="Chi ha fatto cosa, e quando — anche per le azioni simulate">Audit</SectionTitle>
				{audit.length === 0 ? (
					<Empty>Nessuna azione registrata.</Empty>
				) : (
					<ul className="divide-y text-xs" style={{ borderColor: "var(--color-border)" }}>
						{audit.map((row) => (
							<li key={row.auditId} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
								<span style={{ color: "var(--color-text)" }}>
									{row.action} → {row.targetId}
								</span>
								<span className="flex items-center gap-2" style={{ color: "var(--color-text-muted)" }}>
									<span>{row.principalId}</span>
									<span>{row.requestedAt.slice(0, 16).replace("T", " ")}</span>
									<Badge tone={row.status === "approved_simulated" ? "ok" : "neutral"}>{row.status}</Badge>
								</span>
							</li>
						))}
					</ul>
				)}
			</Card>

			<DemoNote>
				In modalità demo gli adapter di invio (email SES, canali OpenClaw, provider telefonico, NLPearl) sono
				bloccati lato server: una chiamata a quei percorsi fallisce con un errore esplicito e non contatta alcun
				fornitore. L&apos;approvazione qui registra solo un evento di audit.
			</DemoNote>
		</div>
	);
}
