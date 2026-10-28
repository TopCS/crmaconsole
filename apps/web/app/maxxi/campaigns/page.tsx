"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Badge, Card, DemoNote, Empty, ErrorNote, Loading, PageHeader, SectionTitle } from "../ui";

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

const STEPS = [
	"Segmento",
	"Proposta",
	"Verifica consenso",
	"Anteprima",
	"Simula approvazione",
];

const AUDIT_STATUS_LABEL: Record<string, string> = {
	draft: "Bozza",
	approved_simulated: "Simulata",
	ok: "OK",
};

const AUDIT_LABEL: Record<string, string> = {
	maxxi_seed: "Seed dati demo",
	campaign_draft_created: "Bozza creata",
	campaign_approval_simulated: "Approvazione simulata",
	operator_create: "Utente creato",
	operator_update: "Utente aggiornato",
	operator_delete: "Utente eliminato",
};

export default function CampaignsPage() {
	const [campaigns, setCampaigns] = useState<Campaign[]>([]);
	const [audit, setAudit] = useState<AuditRow[]>([]);
	const [demoMode, setDemoMode] = useState<boolean | null>(null);
	const [loading, setLoading] = useState(true);
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
		} finally {
			setLoading(false);
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

	if (loading) {return <Loading label="Caricamento campagne…" />;}

	return (
		<div className="space-y-6">
			<PageHeader
				eyebrow="Attivazione / Campagne"
				title="Campagne in dry-run"
				subtitle="Composizione, anteprima e approvazione simulata. Nessun messaggio può essere inviato: l'approvazione registra solo un evento di audit."
				actions={
					<>
						<Badge tone="warn">Nessun invio esterno</Badge>
						<Link href="/maxxi/segments" className="maxxi-secondary-action">
							Apri segmento
						</Link>
					</>
				}
			/>

			{error && <ErrorNote>{error}</ErrorNote>}

			<Card>
				<SectionTitle hint="Il flusso resta sempre entro la modalità dimostrativa">
					Modalità dimostrativa: nessuna comunicazione sarà inviata
				</SectionTitle>
				<ol className="grid grid-cols-1 gap-2 sm:grid-cols-5">
					{STEPS.map((step, index) => (
						<li key={step} className="flex items-start gap-2 border-t pt-2" style={{ borderColor: "var(--maxxi-line)" }}>
							<span className="maxxi-kpi-value text-[16px]">{String(index + 1).padStart(2, "0")}</span>
							<span className="text-[12px] leading-snug">{step}</span>
						</li>
					))}
				</ol>
			</Card>

			{demoMode === false && (
				<Card>
					<Badge tone="bad">Demo mode spento</Badge>
					<p className="mt-2 text-[12.5px]" style={{ color: "var(--maxxi-muted)" }}>
						CRM_A_DEMO_MODE non è attivo: il kill-switch degli invii non è in forza. Per la demo va impostato a 1.
					</p>
				</Card>
			)}

			<Card>
				<SectionTitle hint="Solo bozze: il delivery resta dry_run">Bozze</SectionTitle>
				{campaigns.length === 0 ? (
					<Empty>Nessuna bozza. Creala dal segmento.</Empty>
				) : (
					<ul className="divide-y" style={{ borderColor: "var(--maxxi-line)" }}>
						{campaigns.map((campaign) => {
							const approved = campaign.status === "approved_simulated";
							return (
								<li key={campaign.campaignId} className="py-4">
									<div className="flex flex-wrap items-start justify-between gap-3">
										<div className="min-w-0">
											<strong className="text-[14px]">{campaign.subject}</strong>
											<p className="mt-1 max-w-3xl text-[12.5px] leading-relaxed" style={{ color: "var(--maxxi-muted)" }}>
												{campaign.body}
											</p>
										</div>
										<div className="flex flex-wrap items-center gap-2">
											<Badge tone={approved ? "ok" : "neutral"}>
												{approved ? "Approvata (simulata)" : "Bozza"}
											</Badge>
											<Badge tone="warn">{campaign.deliveryMode}</Badge>
										</div>
									</div>
									<div className="mt-3 flex flex-wrap items-center justify-between gap-3">
										<p className="text-[11px]" style={{ color: "var(--maxxi-muted)" }}>
											{campaign.campaignId} · segmento {campaign.segmentId} · {campaign.createdAt.slice(0, 16).replace("T", " ")} · creato da {campaign.createdBy}
										</p>
										{!approved ? (
											<button
												type="button"
												onClick={() => approve(campaign.campaignId)}
												disabled={busy === campaign.campaignId}
												className="maxxi-primary-action"
											>
												{busy === campaign.campaignId ? "…" : "Simula approvazione"}
											</button>
										) : (
											<span className="maxxi-status maxxi-status-ok">Nessun invio eseguito</span>
										)}
									</div>
								</li>
							);
						})}
					</ul>
				)}
			</Card>

			<Card className="p-0">
				<div className="p-4 pb-0 sm:p-5 sm:pb-0">
					<SectionTitle hint="Chi ha fatto cosa, e quando — anche per le azioni simulate">Audit</SectionTitle>
				</div>
				{audit.length === 0 ? (
					<Empty>Nessuna azione registrata.</Empty>
				) : (
					<div className="maxxi-table-scroll">
						<table className="maxxi-table">
							<caption className="sr-only">Registro delle azioni simulate</caption>
							<thead>
								<tr>
									<th scope="col">Azione</th>
									<th scope="col">Target</th>
									<th scope="col">Utente</th>
									<th scope="col">Quando</th>
									<th scope="col">Stato</th>
								</tr>
							</thead>
							<tbody>
								{audit.map((row) => (
									<tr key={row.auditId}>
										<th scope="row" className="font-medium">{AUDIT_LABEL[row.action] ?? row.action}</th>
										<td className="break-all text-[12px]">{row.targetId}</td>
										<td className="text-[12px]">{row.principalId}</td>
										<td className="text-[12px]" style={{ color: "var(--maxxi-muted)" }}>
											{row.requestedAt.slice(0, 16).replace("T", " ")}
										</td>
										<td>
											<Badge tone={row.status === "approved_simulated" ? "ok" : "neutral"}>
												{AUDIT_STATUS_LABEL[row.status] ?? row.status}
											</Badge>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
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
