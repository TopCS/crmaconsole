"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge, Card, DemoNote, Empty, ErrorNote, Loading, PageHeader, SectionTitle } from "../ui";

type Member = { personId: string; name: string; email: string; segmentReason: string; reasons: string[] };

type SegmentResponse = {
	segment: {
		segmentId: string;
		segmentName: string;
		windowFrom: string;
		windowTo: string;
		eligible: Member[];
		excluded: Member[];
		counts: { eligible: number; excludedConsent: number; excludedIdentity: number; excludedMissingData: number };
	};
	catalog: Array<{ id: string; title: string; startDate: string; endDate: string; isPublicReal: boolean }>;
};

const REASON_LABEL: Record<string, string> = {
	included: "Incluso",
	excluded_consent: "Consenso mancante o revocato",
	excluded_no_interest: "Interesse non pertinente",
	excluded_membership_window: "Card fuori finestra",
	excluded_no_interaction: "Nessuna interazione",
	excluded_identity_uncertain: "Identità incerta",
};

const REASON_TONE: Record<string, "ok" | "warn" | "bad" | "neutral"> = {
	included: "ok",
	excluded_consent: "bad",
	excluded_identity_uncertain: "warn",
};

function summary(members: Member[]): string {
	return members[0]?.reasons.join(" ") ?? "";
}

export default function SegmentsPage() {
	const [data, setData] = useState<SegmentResponse | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [creating, setCreating] = useState(false);
	const [message, setMessage] = useState<string | null>(null);
	const [draftId, setDraftId] = useState<string | null>(null);

	useEffect(() => {
		void (async () => {
			try {
				const res = await fetch("/api/maxxi/segment", { cache: "no-store" });
				const body = (await res.json()) as SegmentResponse & { error?: string };
				if (!res.ok) {throw new Error(body.error ?? `HTTP ${res.status}`);}
				setData(body);
			} catch (err) {
				setError(err instanceof Error ? err.message : "Caricamento fallito.");
			}
		})();
	}, []);

	async function createDraft() {
		setCreating(true);
		setMessage(null);
		setDraftId(null);
		try {
			const exhibition = data?.catalog.find((item) => item.id === "X-ARCH-2026");
			const res = await fetch("/api/maxxi/campaigns", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					subject: "Rinnova la tua myMAXXI — Vitalità dell'architettura italiana 1946-2026",
					body:
						`Con la tua card myMAXXI in scadenza, rinnova per continuare a seguire ` +
						`"${exhibition?.title ?? "Vitalità dell'architettura italiana 1946-2026"}" ` +
						`(${exhibition?.startDate ?? ""} – ${exhibition?.endDate ?? ""}). ` +
						`Bozza dimostrativa: nessun invio verrà effettuato.`,
				}),
			});
			const body = (await res.json()) as { error?: string; draft?: { campaignId: string; counts: { eligible: number } } };
			if (!res.ok || !body.draft) {throw new Error(body.error ?? `HTTP ${res.status}`);}
			setDraftId(body.draft.campaignId);
			setMessage(`Bozza creata (${body.draft.campaignId}) per ${body.draft.counts.eligible} destinatari eleggibili — dry run.`);
		} catch (err) {
			setMessage(err instanceof Error ? err.message : "Creazione bozza fallita.");
		} finally {
			setCreating(false);
		}
	}

	if (error) {return <ErrorNote>{error}</ErrorNote>;}
	if (!data) {return <Loading label="Calcolo del segmento…" />;}

	const { segment } = data;
	const evaluated = segment.eligible.length + segment.excluded.length;
	const groups = new Map<string, Member[]>();
	for (const member of segment.excluded) {
		const list = groups.get(member.segmentReason) ?? [];
		list.push(member);
		groups.set(member.segmentReason, list);
	}
	const assistantQuestion = encodeURIComponent(
		"Quali visitatori interessati all'architettura hanno una card myMAXXI in scadenza entro 45 giorni e consenso email?",
	);

	return (
		<div className="space-y-6">
			<PageHeader
				eyebrow="Pubblico / Segmenti"
				title="Segmento myMAXXI in scadenza"
				subtitle={`${segment.segmentName} · finestra ${segment.windowFrom} → ${segment.windowTo}. Il calcolo è deterministico e ogni esclusione riporta il proprio motivo.`}
				actions={
					<Link href={`/maxxi/agent?q=${assistantQuestion}`} className="maxxi-secondary-action">
						Chiedi all&apos;assistente
					</Link>
				}
			/>

			<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
				<Card>
					<p className="maxxi-eyebrow">Contattabili via email</p>
					<p className="maxxi-kpi-value mt-2 text-[44px]">{segment.counts.eligible}</p>
					<p className="mt-2 text-[12.5px]" style={{ color: "var(--maxxi-muted)" }}>
						Persone che soddisfano i criteri e hanno un consenso email valido per questa finalità.
					</p>
				</Card>
				<Card>
					<p className="maxxi-eyebrow">Persone valutate</p>
					<p className="maxxi-kpi-value mt-2 text-[44px]">{evaluated}</p>
					<p className="mt-2 text-[12.5px]" style={{ color: "var(--maxxi-muted)" }}>
						Audience esaminata dal segmento, incluse le esclusioni motivate qui sotto.
					</p>
				</Card>
			</div>

			<div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
				<Card>
					<p className="maxxi-eyebrow">Esclusi · consenso</p>
					<p className="maxxi-kpi-value mt-1 text-[26px]">{segment.counts.excludedConsent}</p>
				</Card>
				<Card>
					<p className="maxxi-eyebrow">Esclusi · identità</p>
					<p className="maxxi-kpi-value mt-1 text-[26px]">{segment.counts.excludedIdentity}</p>
				</Card>
				<Card>
					<p className="maxxi-eyebrow">Esclusi · dati o condizioni</p>
					<p className="maxxi-kpi-value mt-1 text-[26px]">{segment.counts.excludedMissingData}</p>
				</Card>
			</div>

			<div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
				<Card className="p-0 lg:col-span-2">
					<div className="p-4 pb-0 sm:p-5 sm:pb-0">
						<SectionTitle hint="Ogni inclusione ed esclusione ha una motivazione verificabile">
							Audience
						</SectionTitle>
					</div>
					{evaluated === 0 ? (
						<Empty>Nessun contatto valutato.</Empty>
					) : (
						<div className="maxxi-table-scroll">
							<table className="maxxi-table">
								<caption className="sr-only">Persone incluse ed escluse dal segmento</caption>
								<thead>
									<tr>
										<th scope="col">Persona</th>
										<th scope="col">Stato</th>
										<th scope="col">Motivo</th>
									</tr>
								</thead>
								<tbody>
									{segment.eligible.map((member) => (
										<tr key={member.personId}>
											<th scope="row">
												<Link
													href={`/maxxi/people?id=${encodeURIComponent(member.personId)}`}
													className="font-medium underline-offset-2 hover:underline"
												>
													{member.name}
												</Link>
												<span className="mt-0.5 block text-[11.5px] font-normal" style={{ color: "var(--maxxi-muted)" }}>
													{member.email}
												</span>
											</th>
											<td>
												<Badge tone="ok">Contattabile</Badge>
											</td>
											<td className="text-[12px]" style={{ color: "var(--maxxi-muted)" }}>
												{summary([member])}
											</td>
										</tr>
									))}
									{segment.excluded.map((member) => (
										<tr key={member.personId}>
											<th scope="row">
												<Link
													href={`/maxxi/people?id=${encodeURIComponent(member.personId)}`}
													className="font-medium underline-offset-2 hover:underline"
												>
													{member.name}
												</Link>
												<span className="mt-0.5 block text-[11.5px] font-normal" style={{ color: "var(--maxxi-muted)" }}>
													{member.email}
												</span>
											</th>
											<td>
												<Badge tone={REASON_TONE[member.segmentReason] ?? "neutral"}>
													{REASON_LABEL[member.segmentReason] ?? member.segmentReason}
												</Badge>
											</td>
											<td className="text-[12px]" style={{ color: "var(--maxxi-muted)" }}>
												{summary([member])}
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}
				</Card>

				<Card>
					<SectionTitle hint="Esclusioni raggruppate per motivo">Perché restano fuori</SectionTitle>
					{groups.size === 0 ? (
						<Empty>Nessuna esclusione.</Empty>
					) : (
						<ul className="divide-y" style={{ borderColor: "var(--maxxi-line)" }}>
							{[...groups.entries()].map(([reason, members]) => (
								<li key={reason} className="flex items-center justify-between gap-3 py-3">
									<span className="text-[12.5px]">{REASON_LABEL[reason] ?? reason}</span>
									<span className="maxxi-kpi-value text-[18px]">{members.length}</span>
								</li>
							))}
						</ul>
					)}
					<p className="mt-3 border-t pt-3 text-[11.5px]" style={{ borderColor: "var(--maxxi-line)", color: "var(--maxxi-muted)" }}>
						Un&apos;esclusione per consenso non viene mai conteggiata due volte.
					</p>
				</Card>
			</div>

			<Card>
				<SectionTitle hint="Il testo cita solo il catalogo pubblico reale; nessun invio">
					Proposta di comunicazione
				</SectionTitle>
				<ul className="mb-4 space-y-2 text-[12px]" style={{ color: "var(--maxxi-muted)" }}>
					{data.catalog.map((item) => (
						<li key={item.id} className="flex flex-wrap items-baseline justify-between gap-2 border-b pb-2" style={{ borderColor: "var(--maxxi-line)" }}>
							<span>
								<strong className="text-[12.5px]" style={{ color: "var(--maxxi-ink)" }}>{item.title}</strong>
								<span className="ml-2">
									{item.startDate} → {item.endDate}
								</span>
							</span>
							<span className="text-[11px] uppercase tracking-[0.08em]">
								{item.isPublicReal ? "Mostra pubblica reale" : "Catalogo demo"}
							</span>
						</li>
					))}
				</ul>
				<div className="flex flex-wrap items-center gap-3">
					<button
						type="button"
						onClick={createDraft}
						disabled={creating}
						className="maxxi-primary-action"
					>
						{creating ? "Creazione…" : "Crea bozza (dry run)"}
					</button>
					<Link href="/maxxi/campaigns" className="maxxi-secondary-action">
						Vai alle campagne
					</Link>
				</div>
				{message && (
					<div className="mt-3 flex flex-wrap items-center gap-3">
						<p className="text-[12px]" role="status" style={{ color: "var(--maxxi-muted)" }}>
							{message}
						</p>
						{draftId && (
							<Link href={`/maxxi/campaigns?id=${encodeURIComponent(draftId)}`} className="maxxi-secondary-action">
								Apri bozza
							</Link>
						)}
					</div>
				)}
				<DemoNote>
					La bozza resta nel workspace demo. Nessuna email, SMS o telefonata viene inviata: in modalità demo i
					provider di invio sono bloccati lato server.
				</DemoNote>
			</Card>
		</div>
	);
}
