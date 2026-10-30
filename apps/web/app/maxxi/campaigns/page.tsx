"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Badge, Card, DemoNote, Empty, ErrorNote, Loading, PageHeader, SectionTitle } from "../ui";
import { hasRole, useMe } from "../use-me";

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

type Member = { personId: string; name: string; email: string; segmentReason: string; reasons: string[] };

type CampaignVersion = {
	version: number;
	subject: string;
	body: string;
	createdBy: string;
	createdAt: string;
};

type CampaignSnapshot = {
	approvedBy: string;
	approvedAt: string;
	recipients: Member[];
	exclusions: Array<Member & { reason: string }>;
	counts: { eligible: number; excludedConsent: number; excludedIdentity: number; excludedMissingData: number };
};

type CampaignDetail = {
	campaign: Campaign;
	segment: {
		segmentId: string;
		segmentName: string;
		windowFrom: string;
		windowTo: string;
		counts: { eligible: number; excludedConsent: number; excludedIdentity: number; excludedMissingData: number };
		eligible: Member[];
		excluded: Member[];
	};
	excludedGroups: Array<{ reason: string; count: number }>;
	recipientsVisible: boolean;
	versions: CampaignVersion[];
	snapshot: CampaignSnapshot | null;
	audit: AuditRow[];
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
	campaign_version_created: "Nuova versione",
	campaign_approval_simulated: "Approvazione simulata",
	operator_create: "Utente creato",
	operator_update: "Utente aggiornato",
	operator_delete: "Utente eliminato",
};

const REASON_LABEL: Record<string, string> = {
	included: "Incluso",
	excluded_consent: "Consenso mancante o revocato",
	excluded_no_interest: "Interesse non pertinente",
	excluded_membership_window: "Card fuori finestra",
	excluded_no_interaction: "Nessuna interazione",
	excluded_identity_uncertain: "Identità incerta",
};

function statusLabel(status: string): string {
	return status === "approved_simulated" ? "Approvata (simulata)" : "Bozza";
}

function formatDate(value: string | null): string {
	return value ? value.slice(0, 16).replace("T", " ") : "—";
}

export default function CampaignsPage() {
	return (
		<Suspense fallback={<Loading label="Caricamento campagne…" />}>
			<CampaignsInner />
		</Suspense>
	);
}

function CampaignsInner() {
	const router = useRouter();
	const searchParams = useSearchParams();
	const { me } = useMe();
	const canApprove = hasRole(me, "communication") || hasRole(me, "admin");
	const [campaigns, setCampaigns] = useState<Campaign[]>([]);
	const [audit, setAudit] = useState<AuditRow[]>([]);
	const [demoMode, setDemoMode] = useState<boolean | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState<string | null>(null);

	const [detailId, setDetailId] = useState<string | null>(searchParams.get("id"));
	const [detail, setDetail] = useState<CampaignDetail | null>(null);
	const [detailLoading, setDetailLoading] = useState(false);
	const [detailError, setDetailError] = useState<string | null>(null);
	const closeRef = useRef<HTMLButtonElement>(null);
	const [editing, setEditing] = useState(false);
	const [editSubject, setEditSubject] = useState("");
	const [editBody, setEditBody] = useState("");
	const [saving, setSaving] = useState(false);
	const [editError, setEditError] = useState<string | null>(null);
	const [compareVersion, setCompareVersion] = useState<number | null>(null);

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

	const loadDetail = useCallback(async (id: string) => {
		setDetailLoading(true);
		setDetail(null);
		setDetailError(null);
		setEditing(false);
		setCompareVersion(null);
		try {
			const res = await fetch(`/api/maxxi/campaigns?id=${encodeURIComponent(id)}`, { cache: "no-store" });
			const body = (await res.json()) as CampaignDetail & { error?: string };
			if (!res.ok) {throw new Error(body.error ?? `HTTP ${res.status}`);}
			setDetail(body);
		} catch (err) {
			setDetailError(err instanceof Error ? err.message : "Dettaglio non disponibile.");
		} finally {
			setDetailLoading(false);
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	useEffect(() => {
		if (detailId) {void loadDetail(detailId);}
		else {setDetail(null);}
	}, [detailId, loadDetail]);

	useEffect(() => {
		if (!detailId) {return;}
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") {closeDetail();}
		};
		document.addEventListener("keydown", onKey);
		const previous = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		closeRef.current?.focus();
		return () => {
			document.removeEventListener("keydown", onKey);
			document.body.style.overflow = previous;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [detailId]);

	function openDetail(id: string) {
		setDetailId(id);
		router.replace(`/maxxi/campaigns?id=${encodeURIComponent(id)}`, { scroll: false });
	}

	function closeDetail() {
		setDetailId(null);
		setDetail(null);
		router.replace("/maxxi/campaigns", { scroll: false });
	}

	function startEdit() {
		if (!detail) {return;}
		setEditSubject(detail.campaign.subject);
		setEditBody(detail.campaign.body);
		setEditError(null);
		setEditing(true);
	}

	async function saveEdit() {
		if (!detail) {return;}
		setSaving(true);
		setEditError(null);
		try {
			const res = await fetch("/api/maxxi/campaigns", {
				method: "PATCH",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					id: detail.campaign.campaignId,
					subject: editSubject,
					body: editBody,
				}),
			});
			const body = (await res.json()) as { error?: string; version?: number };
			if (!res.ok) {throw new Error(body.error ?? `HTTP ${res.status}`);}
			setEditing(false);
			await load();
			await loadDetail(detail.campaign.campaignId);
		} catch (err) {
			setEditError(err instanceof Error ? err.message : "Salvataggio fallito.");
		} finally {
			setSaving(false);
		}
	}

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
			if (detailId === campaignId) {await loadDetail(campaignId);}
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
				<SectionTitle hint="Apri una bozza per testo completo, anteprima, destinatari ed esclusioni">
					Bozze
				</SectionTitle>
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
											<button
												type="button"
												onClick={() => openDetail(campaign.campaignId)}
												className="text-left text-[14px] font-semibold underline-offset-2 hover:underline"
											>
												{campaign.subject}
											</button>
											<p className="mt-1 max-w-3xl whitespace-pre-wrap text-[12.5px] leading-relaxed" style={{ color: "var(--maxxi-muted)" }}>
												{campaign.body}
											</p>
										</div>
										<div className="flex flex-wrap items-center gap-2">
											<Badge tone={approved ? "ok" : "neutral"}>{statusLabel(campaign.status)}</Badge>
											<Badge tone="warn">{campaign.deliveryMode}</Badge>
										</div>
									</div>
									<div className="mt-3 flex flex-wrap items-center justify-between gap-3">
										<p className="text-[11px]" style={{ color: "var(--maxxi-muted)" }}>
											{campaign.campaignId} · segmento {campaign.segmentId} · {formatDate(campaign.createdAt)} · creato da {campaign.createdBy}
										</p>
										<div className="flex flex-wrap gap-2">
											<button type="button" onClick={() => openDetail(campaign.campaignId)} className="maxxi-secondary-action">
												Dettaglio
											</button>
											{!approved && canApprove && (
												<button
													type="button"
													onClick={() => approve(campaign.campaignId)}
													disabled={busy === campaign.campaignId}
													className="maxxi-primary-action"
												>
													{busy === campaign.campaignId ? "…" : "Simula approvazione"}
												</button>
											)}
											{approved && <span className="maxxi-status maxxi-status-ok">Nessun invio eseguito</span>}
										</div>
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
											{formatDate(row.requestedAt)}
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

			{detailId && (
				<div
					className="fixed inset-0 z-50 flex justify-end bg-black/55"
					role="presentation"
					onMouseDown={(event) => { if (event.target === event.currentTarget) {closeDetail();} }}
				>
					<div
						role="dialog"
						aria-modal="true"
						aria-labelledby="campaign-detail-title"
						className="h-full w-full max-w-2xl overflow-y-auto p-5 sm:p-7"
						style={{ background: "var(--maxxi-paper)" }}
					>
						<div className="flex items-start justify-between gap-4 border-b pb-4" style={{ borderColor: "var(--maxxi-line)" }}>
							<div className="min-w-0">
								<p className="maxxi-eyebrow">Dettaglio bozza</p>
								<h2 id="campaign-detail-title" className="maxxi-section-title mt-2">
									{detail?.campaign.subject ?? "Caricamento…"}
								</h2>
							</div>
							<button
								ref={closeRef}
								type="button"
								onClick={closeDetail}
								className="maxxi-secondary-action"
								aria-label="Chiudi dettaglio"
							>
								Chiudi
							</button>
						</div>

						{detailLoading && <Loading label="Caricamento dettaglio…" />}
						{detailError && <div className="mt-4"><ErrorNote>{detailError}</ErrorNote></div>}

						{detail && (
							<div className="mt-5 space-y-6">
								<div className="flex flex-wrap items-center gap-2">
									<Badge tone={detail.campaign.status === "approved_simulated" ? "ok" : "neutral"}>
										{statusLabel(detail.campaign.status)}
									</Badge>
									<Badge tone="warn">{detail.campaign.deliveryMode}</Badge>
									<span className="maxxi-status maxxi-status-ok">Nessun invio esterno</span>
								</div>

								<dl className="grid grid-cols-1 gap-3 text-[12px] sm:grid-cols-2">
									<div>
										<dt className="maxxi-eyebrow">Campaign ID</dt>
										<dd className="mt-1 break-all">{detail.campaign.campaignId}</dd>
									</div>
									<div>
										<dt className="maxxi-eyebrow">Segmento</dt>
										<dd className="mt-1">{detail.segment.segmentName} ({detail.segment.segmentId})</dd>
									</div>
									<div>
										<dt className="maxxi-eyebrow">Creato da</dt>
										<dd className="mt-1">{detail.campaign.createdBy}</dd>
									</div>
									<div>
										<dt className="maxxi-eyebrow">Data</dt>
										<dd className="mt-1">{formatDate(detail.campaign.createdAt)}</dd>
									</div>
								</dl>

								<section aria-labelledby="campaign-versions-title">
									<div className="flex flex-wrap items-center justify-between gap-2">
										<h3 id="campaign-versions-title" className="maxxi-section-title">Versione</h3>
										{detail.campaign.status === "draft" && canApprove && !editing && (
											<button type="button" onClick={startEdit} className="maxxi-secondary-action">
												Modifica bozza
											</button>
										)}
									</div>

									{editing ? (
										<div className="mt-3 space-y-3">
											<label className="flex flex-col gap-1.5">
												<span className="maxxi-eyebrow">Oggetto</span>
												<input
													value={editSubject}
													onChange={(event) => setEditSubject(event.target.value)}
													className="maxxi-input"
													maxLength={180}
												/>
											</label>
											<label className="flex flex-col gap-1.5">
												<span className="maxxi-eyebrow">Testo</span>
												<textarea
													value={editBody}
													onChange={(event) => setEditBody(event.target.value)}
													className="maxxi-input min-h-[180px]"
													maxLength={4000}
												/>
											</label>
											{editError && <ErrorNote>{editError}</ErrorNote>}
											<div className="flex flex-wrap gap-2">
												<button
													type="button"
													onClick={() => void saveEdit()}
													disabled={saving || !editSubject.trim() || !editBody.trim()}
													className="maxxi-primary-action"
												>
													{saving ? "Salvataggio…" : "Salva nuova versione"}
												</button>
												<button type="button" onClick={() => setEditing(false)} className="maxxi-secondary-action">
													Annulla
												</button>
											</div>
										</div>
									) : (
										<p className="mt-1 text-[12px]" style={{ color: "var(--maxxi-muted)" }}>
											Versione {detail.versions[0]?.version ?? 1} di {detail.versions.length || 1}
											{detail.versions[0] ? ` · ${detail.versions[0].createdBy} · ${formatDate(detail.versions[0].createdAt)}` : ""}
										</p>
									)}

									{!editing && detail.versions.length > 1 && (() => {
										const compare =
											detail.versions.find((version) => version.version === compareVersion) ??
											detail.versions[1];
										return (
											<details className="mt-3 border-t pt-3" style={{ borderColor: "var(--maxxi-line)" }}>
												<summary className="cursor-pointer text-[12px] font-semibold">
													Confronta versioni ({detail.versions.length})
												</summary>
												<div className="mt-2 flex flex-wrap gap-1.5">
													{detail.versions.map((version) => (
														<button
															key={version.version}
															type="button"
															onClick={() => setCompareVersion(version.version)}
															className="border px-2 py-1 text-[11px]"
															style={{
																borderColor: compare?.version === version.version ? "var(--maxxi-ink)" : "var(--maxxi-line-strong)",
																background: compare?.version === version.version ? "var(--maxxi-ink)" : "var(--maxxi-paper)",
																color: compare?.version === version.version ? "#ffffff" : "var(--maxxi-ink)",
															}}
														>
															v{version.version} · {formatDate(version.createdAt)}
														</button>
													))}
												</div>
												{compare && (
													<div className="mt-3 grid gap-3 sm:grid-cols-2">
														<div className="border p-3" style={{ borderColor: "var(--maxxi-line)" }}>
															<p className="maxxi-eyebrow">v{compare.version}</p>
															<p className="mt-1 text-[12px] font-semibold">{compare.subject}</p>
															<p className="mt-2 whitespace-pre-wrap text-[11.5px]" style={{ color: "var(--maxxi-muted)" }}>{compare.body}</p>
														</div>
														<div className="border p-3" style={{ borderColor: "var(--maxxi-line)" }}>
															<p className="maxxi-eyebrow">Corrente</p>
															<p className="mt-1 text-[12px] font-semibold">{detail.campaign.subject}</p>
															<p className="mt-2 whitespace-pre-wrap text-[11.5px]" style={{ color: "var(--maxxi-muted)" }}>{detail.campaign.body}</p>
														</div>
													</div>
												)}
											</details>
										);
									})()}
								</section>

								<section aria-labelledby="campaign-preview-title">
									<h3 id="campaign-preview-title" className="maxxi-section-title">Anteprima</h3>
									<div className="mt-2 border p-4" style={{ borderColor: "var(--maxxi-line)" }}>
										<p className="text-[11px] uppercase tracking-[0.08em]" style={{ color: "var(--maxxi-muted)" }}>
											Oggetto
										</p>
										<p className="mt-1 text-[14px] font-semibold">{detail.campaign.subject}</p>
										<hr className="my-3" style={{ borderColor: "var(--maxxi-line)" }} />
										<p className="whitespace-pre-wrap text-[13px] leading-relaxed">{detail.campaign.body}</p>
									</div>
									<p className="mt-2 text-[11px]" style={{ color: "var(--maxxi-muted)" }}>
										Testo dimostrativo: non è stato inviato a nessun destinatario.
									</p>
								</section>

								<section aria-labelledby="campaign-audience-title">
									<h3 id="campaign-audience-title" className="maxxi-section-title">Destinatari</h3>
									<p className="mt-1 text-[12px]" style={{ color: "var(--maxxi-muted)" }}>
										Finestra {detail.segment.windowFrom} → {detail.segment.windowTo}
									</p>
									<div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
										<div className="border p-2.5" style={{ borderColor: "var(--maxxi-line)" }}>
											<p className="maxxi-eyebrow">Eleggibili</p>
											<p className="maxxi-kpi-value mt-1 text-[22px]">{detail.segment.counts.eligible}</p>
										</div>
										<div className="border p-2.5" style={{ borderColor: "var(--maxxi-line)" }}>
											<p className="maxxi-eyebrow">Consenso</p>
											<p className="maxxi-kpi-value mt-1 text-[22px]">{detail.segment.counts.excludedConsent}</p>
										</div>
										<div className="border p-2.5" style={{ borderColor: "var(--maxxi-line)" }}>
											<p className="maxxi-eyebrow">Identità</p>
											<p className="maxxi-kpi-value mt-1 text-[22px]">{detail.segment.counts.excludedIdentity}</p>
										</div>
										<div className="border p-2.5" style={{ borderColor: "var(--maxxi-line)" }}>
											<p className="maxxi-eyebrow">Dati/condizioni</p>
											<p className="maxxi-kpi-value mt-1 text-[22px]">{detail.segment.counts.excludedMissingData}</p>
										</div>
									</div>

									{detail.recipientsVisible ? (
										<div className="maxxi-table-scroll mt-3">
											<table className="maxxi-table">
												<caption className="sr-only">Destinatari eleggibili</caption>
												<thead>
													<tr>
														<th scope="col">Persona</th>
														<th scope="col">Email</th>
													</tr>
												</thead>
												<tbody>
													{detail.segment.eligible.map((member) => (
														<tr key={member.personId}>
															<th scope="row">{member.name}</th>
															<td>{member.email}</td>
														</tr>
													))}
												</tbody>
											</table>
										</div>
									) : (
										<p className="mt-3 text-[12px]" style={{ color: "var(--maxxi-muted)" }}>
											Il tuo ruolo vede i conteggi ma non i contatti personali.
										</p>
									)}
								</section>

								{detail.snapshot && (
									<section aria-labelledby="campaign-snapshot-title">
										<h3 id="campaign-snapshot-title" className="maxxi-section-title">Snapshot dell’approvazione</h3>
										<p className="mt-1 text-[12px]" style={{ color: "var(--maxxi-muted)" }}>
											Congelato il {formatDate(detail.snapshot.approvedAt)} da {detail.snapshot.approvedBy}.
											Destinatari: {detail.snapshot.recipients.length}; esclusioni: {detail.snapshot.exclusions.length}.
										</p>
										{detail.recipientsVisible && detail.snapshot.recipients.length > 0 && (
											<div className="maxxi-table-scroll mt-3">
												<table className="maxxi-table">
													<caption className="sr-only">Destinatari al momento dell’approvazione simulata</caption>
													<thead>
														<tr>
															<th scope="col">Persona</th>
															<th scope="col">Email</th>
														</tr>
													</thead>
													<tbody>
														{detail.snapshot.recipients.map((member) => (
															<tr key={`snapshot-${member.personId}`}>
																<th scope="row">{member.name}</th>
																<td>{member.email}</td>
															</tr>
														))}
													</tbody>
												</table>
											</div>
										)}
										<p className="mt-2 text-[11px]" style={{ color: "var(--maxxi-muted)" }}>
											La snapshot è immutabile: modifiche successive al segmento non cambiano l’audience approvata.
										</p>
									</section>
								)}

								<section aria-labelledby="campaign-exclusions-title">
									<h3 id="campaign-exclusions-title" className="maxxi-section-title">Esclusioni</h3>
									<ul className="mt-2 divide-y" style={{ borderColor: "var(--maxxi-line)" }}>
										{detail.excludedGroups.map((group) => (
											<li key={group.reason} className="flex items-center justify-between gap-3 py-2 text-[12.5px]">
												<span>{REASON_LABEL[group.reason] ?? group.reason}</span>
												<span className="maxxi-kpi-value text-[16px]">{group.count}</span>
											</li>
										))}
										{detail.excludedGroups.length === 0 && <li className="py-2 text-[12.5px]" style={{ color: "var(--maxxi-muted)" }}>Nessuna esclusione.</li>}
									</ul>
								</section>

								<section aria-labelledby="campaign-audit-title">
									<h3 id="campaign-audit-title" className="maxxi-section-title">Audit della bozza</h3>
									<ul className="mt-2 divide-y" style={{ borderColor: "var(--maxxi-line)" }}>
										{detail.audit.map((row) => (
											<li key={row.auditId} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[12px]">
												<span>{AUDIT_LABEL[row.action] ?? row.action}</span>
												<span style={{ color: "var(--maxxi-muted)" }}>{row.principalId} · {formatDate(row.requestedAt)}</span>
											</li>
										))}
										{detail.audit.length === 0 && <li className="py-2 text-[12px]" style={{ color: "var(--maxxi-muted)" }}>Nessuna azione registrata.</li>}
									</ul>
								</section>

								{detail.campaign.status !== "approved_simulated" && canApprove && (
									<div className="flex flex-wrap gap-2 border-t pt-4" style={{ borderColor: "var(--maxxi-line)" }}>
										<button
											type="button"
											onClick={() => void approve(detail.campaign.campaignId)}
											disabled={busy === detail.campaign.campaignId}
											className="maxxi-primary-action"
										>
											{busy === detail.campaign.campaignId ? "…" : "Simula approvazione"}
										</button>
									</div>
								)}
							</div>
						)}
					</div>
				</div>
			)}
		</div>
	);
}
