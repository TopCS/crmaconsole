"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge, Card, DemoNote, Empty, ErrorNote, Loading, PageHeader, SectionTitle } from "../ui";
import { StepBrief } from "../flow";

type Member = { personId: string; name: string; email: string; segmentReason: string; reasons: string[] };

type Proposal = {
	mode: "llm" | "template";
	subject: string;
	body: string;
	sources: string[];
	model?: string | null;
	fallbackReason?: string;
};

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

const REASON_HELP: Record<string, string> = {
	excluded_consent: "Il consenso email per eventi e marketing non è concesso o è stato revocato.",
	excluded_no_interest: "Nessun interesse esplicito per l'architettura: non è un pubblico pertinente.",
	excluded_membership_window: "La card myMAXXI non scade nella finestra di 45 giorni.",
	excluded_no_interaction: "Nessuna interazione utile a giustificare il contatto.",
	excluded_identity_uncertain: "L'identità non è verificata con certezza sufficiente.",
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
	const [proposal, setProposal] = useState<Proposal | null>(null);
	const [generating, setGenerating] = useState(false);
	const [savingProposal, setSavingProposal] = useState(false);
	const [verified, setVerified] = useState(false);

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

	async function generateProposal() {
		setGenerating(true);
		setMessage(null);
		try {
			const res = await fetch("/api/maxxi/campaigns/proposal", { method: "POST" });
			const body = (await res.json()) as { proposal?: Proposal; error?: string };
			if (!res.ok || !body.proposal) {throw new Error(body.error ?? `HTTP ${res.status}`);}
			setVerified(false);
			setProposal(body.proposal);
		} catch (err) {
			setMessage(err instanceof Error ? err.message : "Generazione proposta fallita.");
		} finally {
			setGenerating(false);
		}
	}

	async function saveProposal() {
		if (!proposal) {return;}
		setSavingProposal(true);
		setMessage(null);
		setDraftId(null);
		try {
			const res = await fetch("/api/maxxi/campaigns", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ subject: proposal.subject, body: proposal.body }),
			});
			const body = (await res.json()) as { error?: string; draft?: { campaignId: string; counts: { eligible: number } } };
			if (!res.ok || !body.draft) {throw new Error(body.error ?? `HTTP ${res.status}`);}
			setDraftId(body.draft.campaignId);
			setMessage(`Bozza salvata (${body.draft.campaignId}) per ${body.draft.counts.eligible} destinatari — dry run.`);
			setVerified(false);
			setProposal(null);
		} catch (err) {
			setMessage(err instanceof Error ? err.message : "Salvataggio proposta fallito.");
		} finally {
			setSavingProposal(false);
		}
	}

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
	const usedSources = proposal
		? proposal.sources
				.map((id) => data.catalog.find((item) => item.id === id))
				.filter((item): item is SegmentResponse["catalog"][number] => Boolean(item))
		: [];
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

			<StepBrief
				step={2}
				question="Chi possiamo contattare, e chi resta fuori?"
				evidence={`${segment.counts.eligible} contattabili · ${segment.excluded.length} esclusi (${segment.counts.excludedConsent} per consenso)`}
				next={{ href: "/maxxi/campaigns", label: "Prepara la bozza" }}
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
								<li key={reason} className="py-3">
									<div className="flex items-center justify-between gap-3">
										<span className="text-[12.5px] font-semibold">{REASON_LABEL[reason] ?? reason}</span>
										<span className="maxxi-kpi-value text-[18px]">{members.length}</span>
									</div>
									<p className="mt-1 text-[11.5px] leading-relaxed" style={{ color: "var(--maxxi-muted)" }}>
										{REASON_HELP[reason] ?? "Motivo registrato dal calcolo del segmento."}
									</p>
									<p className="mt-1 text-[11px]" style={{ color: "var(--maxxi-muted)" }}>
										{members.map((member) => member.name).join(", ")}
									</p>
								</li>
							))}
						</ul>
					)}
					<div className="mt-3 border-t pt-3" style={{ borderColor: "var(--maxxi-line)" }}>
						<p className="maxxi-eyebrow">Regole applicate</p>
						<ul className="mt-2 space-y-1 text-[11.5px] leading-relaxed" style={{ color: "var(--maxxi-muted)" }}>
							<li>Card in scadenza entro 45 giorni e interesse esplicito per l’architettura.</li>
							<li>Consenso email valido per la finalità: in assenza, la persona resta fuori.</li>
							<li>Identità incerta esclusa finché non esiste una prova sufficiente.</li>
						</ul>
						<p className="mt-2 text-[11px]" style={{ color: "var(--maxxi-muted)" }}>
							Un’esclusione per consenso non viene mai conteggiata due volte.
						</p>
					</div>
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
						onClick={() => void generateProposal()}
						disabled={generating || creating || savingProposal}
						className="maxxi-secondary-action"
					>
						{generating ? "Generazione…" : "Genera proposta AI"}
					</button>
					<button
						type="button"
						onClick={createDraft}
						disabled={creating || generating || savingProposal}
						className="maxxi-primary-action"
					>
						{creating ? "Creazione…" : "Crea bozza (dry run)"}
					</button>
					<Link href="/maxxi/campaigns" className="maxxi-secondary-action">
						Vai alle campagne
					</Link>
				</div>

				{proposal && (
					<div className="mt-4 border-t pt-4" style={{ borderColor: "var(--maxxi-line)" }}>
						<div className="flex flex-wrap items-center gap-2">
							<Badge tone={proposal.mode === "llm" ? "ok" : "warn"}>
								{proposal.mode === "llm" ? "Proposta AI" : "Template verificato"}
							</Badge>
							<span className="text-[11px]" style={{ color: "var(--maxxi-muted)" }}>
								{proposal.model ? `modello ${proposal.model}` : "nessun provider AI: testo deterministico"}
							</span>
						</div>
						<p
							className="mt-3 border-l-4 py-2 pl-3 text-[11.5px] leading-relaxed"
							style={{ borderColor: "var(--maxxi-warning, #8a6d1f)", color: "var(--maxxi-muted)" }}
						>
							{proposal.mode === "llm"
								? "Testo generato: verifica che mostre, date e benefici corrispondano al catalogo. Non aggiungere prezzi, orari o promesse di invio."
								: "Testo deterministico basato sul catalogo verificato: controlla comunque oggetto e date prima di salvare."}
						</p>
						<label className="mt-3 flex flex-col gap-1.5">
							<span className="maxxi-eyebrow">Oggetto</span>
							<input
								value={proposal.subject}
								onChange={(event) => {
									setVerified(false);
									setProposal({ ...proposal, subject: event.target.value });
								}}
								className="maxxi-input"
								maxLength={180}
							/>
						</label>
						<label className="mt-3 flex flex-col gap-1.5">
							<span className="maxxi-eyebrow">Testo</span>
							<textarea
								value={proposal.body}
								onChange={(event) => {
									setVerified(false);
									setProposal({ ...proposal, body: event.target.value });
								}}
								className="maxxi-input min-h-[160px]"
								maxLength={4000}
							/>
						</label>

						<div className="mt-3 border p-3" style={{ borderColor: "var(--maxxi-line)" }}>
							<p className="maxxi-eyebrow">Fonti usate</p>
							{usedSources.length === 0 ? (
								<p className="mt-1 text-[11.5px]" style={{ color: "var(--maxxi-muted)" }}>
									Nessuna fonte puntuale: testo basato sul catalogo demo.
								</p>
							) : (
								<ul className="mt-1 space-y-1">
									{usedSources.map((source) => (
										<li key={source.id} className="flex flex-wrap items-baseline justify-between gap-2 text-[11.5px]">
											<span>
												<strong>{source.title}</strong>
												<span className="ml-2" style={{ color: "var(--maxxi-muted)" }}>
													{source.startDate} → {source.endDate}
												</span>
											</span>
											<Badge tone={source.isPublicReal ? "ok" : "warn"}>
												{source.isPublicReal ? "catalogo reale" : "catalogo demo"}
											</Badge>
										</li>
									))}
								</ul>
							)}
						</div>

						<label className="mt-3 flex items-start gap-2 text-[12px] leading-relaxed">
							<input
								type="checkbox"
								checked={verified}
								onChange={(event) => setVerified(event.target.checked)}
								className="mt-0.5"
							/>
							<span>
								Ho verificato mostra, date e assenza di promesse di invio. Il salvataggio crea solo una bozza
								dry-run.
							</span>
						</label>

						<div className="mt-3 flex flex-wrap items-center gap-3">
							<button
								type="button"
								onClick={() => void saveProposal()}
								disabled={savingProposal || !verified || !proposal.subject.trim() || !proposal.body.trim()}
								className="maxxi-primary-action"
							>
								{savingProposal ? "Salvataggio…" : "Salva come bozza"}
							</button>
							<button
								type="button"
								onClick={() => { setVerified(false); setProposal(null); }}
								className="maxxi-secondary-action"
							>
								Scarta
							</button>
							<span className="maxxi-status maxxi-status-ok">Nessun invio</span>
						</div>
					</div>
				)}
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
