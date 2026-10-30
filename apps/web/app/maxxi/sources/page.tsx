"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Card, DemoNote, Empty, ErrorNote, Loading, PageHeader, SectionTitle } from "../ui";
import { useMe } from "../use-me";
import { roleHasPermission, type OperatorRole } from "../../../lib/security/rbac";

type Overview = {
	sources: Array<{
		sourceSystem: string;
		description: string;
		mockOrLive: string;
		lastImportedAt: string | null;
		status: string;
		rowCount: number;
		unmatchedCount: number;
		quarantinedCount: number;
	}>;
	reviews: Array<{ candidateId: string; name: string; email: string; sourceSystem: string; sourceRecordId: string; reason: string; status: string }>;
};

type ReviewDecision = {
	decision: "keep_separate" | "merge_simulated";
	reason: string;
	decidedBy: string;
	decidedAt: string;
};

type ReviewCase = {
	candidateId: string;
	name: string;
	email: string;
	sourceSystem: string;
	sourceRecordId: string;
	reason: string;
	status: string;
	decision: ReviewDecision | null;
	matches: Array<{ personId: string; name: string; email: string; links: number; memberships: number }>;
};

function formatDate(value: string): string {
	return value ? value.slice(0, 16).replace("T", " ") : "—";
}

export default function SourcesPage() {
	const { me } = useMe();
	const roles = (me?.roles ?? []) as OperatorRole[];
	const canSeePeople = roleHasPermission(roles, "maxxi.people.read");
	const canReview = roleHasPermission(roles, "maxxi.people.review");
	const [data, setData] = useState<Overview | null>(null);
	const [cases, setCases] = useState<ReviewCase[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [decision, setDecision] = useState<"keep_separate" | "merge_simulated">("keep_separate");
	const [reason, setReason] = useState("");
	const [saving, setSaving] = useState(false);

	const loadCases = useCallback(async () => {
		const res = await fetch("/api/maxxi/review", { cache: "no-store" });
		const body = (await res.json()) as { cases?: ReviewCase[]; error?: string };
		if (!res.ok) {throw new Error(body.error ?? `HTTP ${res.status}`);}
		setCases(body.cases ?? []);
	}, []);

	useEffect(() => {
		void (async () => {
			try {
				const overview = await fetch("/api/maxxi/overview", { cache: "no-store" });
				const body = (await overview.json()) as Overview & { error?: string };
				if (!overview.ok) {throw new Error(body.error ?? `HTTP ${overview.status}`);}
				setData(body);

				// The review queue contains personal data. Roles without
				// people.read still see the source table, but not the queue.
				const reviewCases = await fetch("/api/maxxi/review", { cache: "no-store" });
				if (reviewCases.ok) {
					const casesBody = (await reviewCases.json()) as { cases?: ReviewCase[] };
					setCases(casesBody.cases ?? []);
				} else if (reviewCases.status !== 403) {
					throw new Error(`HTTP ${reviewCases.status}`);
				}
			} catch (err) {
				setError(err instanceof Error ? err.message : "Caricamento fallito.");
			}
		})();
	}, []);

	const selected = cases.find((item) => item.candidateId === selectedId) ?? null;

	function openCase(item: ReviewCase) {
		setSelectedId(item.candidateId);
		setDecision(item.decision?.decision ?? "keep_separate");
		setReason(item.decision?.reason ?? "");
		setNotice(null);
	}

	async function submitDecision() {
		if (!selected) {return;}
		setSaving(true);
		setNotice(null);
		try {
			const res = await fetch("/api/maxxi/review", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					candidateId: selected.candidateId,
					decision,
					reason,
				}),
			});
			const body = (await res.json()) as { error?: string; note?: string };
			if (!res.ok) {throw new Error(body.error ?? `HTTP ${res.status}`);}
			setNotice(body.note ?? "Decisione registrata. Nessuna fusione eseguita.");
			await loadCases();
		} catch (err) {
			setNotice(err instanceof Error ? err.message : "Decisione non salvata.");
		} finally {
			setSaving(false);
		}
	}

	if (error) {return <ErrorNote>{error}</ErrorNote>;}
	if (!data) {return <Loading label="Caricamento fonti…" />;}

	return (
		<div className="space-y-6">
			<PageHeader
				eyebrow="Pubblico / Fonti dati"
				title="Fonti e qualità del dato"
				subtitle="Ogni fonte dichiara se il connettore è reale o simulato. Un record non associabile non è un errore: resta anonimo finché non esiste una prova sufficiente."
			/>

			<Card className="p-0">
				{data.sources.length === 0 ? (
					<Empty>Nessuna fonte registrata.</Empty>
				) : (
					<div className="maxxi-table-scroll">
						<table className="maxxi-table">
							<caption className="sr-only">Stato delle fonti e qualità dei record</caption>
							<thead>
								<tr>
									<th scope="col">Fonte</th>
									<th scope="col">Stato</th>
									<th scope="col" className="num">Record</th>
									<th scope="col" className="num">Attribuite</th>
									<th scope="col" className="num">Non associabili</th>
									<th scope="col" className="num">In revisione</th>
									<th scope="col">Ultimo import</th>
								</tr>
							</thead>
							<tbody>
								{data.sources.map((source) => {
									const attributed = Math.max(0, source.rowCount - source.unmatchedCount);
									return (
										<tr key={source.sourceSystem}>
											<th scope="row">
												<span className="font-medium">{source.sourceSystem}</span>
												<span className="mt-1 block max-w-[34ch] text-[11.5px] font-normal" style={{ color: "var(--maxxi-muted)" }}>
													{source.description}
												</span>
											</th>
											<td>
												<div className="flex flex-col gap-1.5">
													<Badge tone={source.status === "ok" ? "ok" : "warn"}>
														{source.status === "ok" ? "Operativa" : "Da verificare"}
													</Badge>
													<Badge tone={source.mockOrLive === "mock" ? "warn" : "ok"}>
														{source.mockOrLive === "mock" ? "Simulata" : "Reale"}
													</Badge>
												</div>
											</td>
											<td className="num">{source.rowCount}</td>
											<td className="num">{attributed}</td>
											<td className="num">{source.unmatchedCount}</td>
											<td className="num">{source.quarantinedCount}</td>
											<td className="text-[12.5px]" style={{ color: "var(--maxxi-muted)" }}>
												{source.lastImportedAt ? source.lastImportedAt.slice(0, 10) : "—"}
											</td>
										</tr>
									);
								})}
							</tbody>
						</table>
					</div>
				)}
				<p className="mt-2 text-[11px] sm:hidden" style={{ color: "var(--maxxi-muted)" }}>
					Scorri la tabella per vedere tutte le colonne.
				</p>
				<DemoNote>
					I tracciati XLS/CSV sono inventati per la demo: non riproducono il formato dei fornitori reali
					(Archeoares, biblioteca, infopoint). Nessuna integrazione con WordPress, Matomo o biglietteria è attiva.
				</DemoNote>
			</Card>

			{canSeePeople && (
			<Card>
				<SectionTitle hint="Nessun merge automatico: confronto e decisione simulata">
					Coda di revisione identità
				</SectionTitle>
				{notice && (
					<p className="mb-3 text-[12px]" role="status" style={{ color: "var(--maxxi-muted)" }}>
						{notice}
					</p>
				)}
				{cases.length === 0 ? (
					<Empty>Nessun candidato in revisione.</Empty>
				) : (
					<ul className="divide-y" style={{ borderColor: "var(--maxxi-line)" }}>
						{cases.map((item) => (
							<li key={item.candidateId} className="grid grid-cols-1 gap-3 py-4 md:grid-cols-[1fr_auto]">
								<div>
									<div className="flex flex-wrap items-center gap-2">
										<strong className="text-[13.5px]">{item.name}</strong>
										<span className="text-[11.5px]" style={{ color: "var(--maxxi-muted)" }}>
											{item.email}
										</span>
										<Badge tone={item.decision ? "ok" : "warn"}>
											{item.decision
												? item.decision.decision === "keep_separate"
													? "Mantenuti separati"
													: "Unione simulata"
												: "Richiede revisione"}
										</Badge>
									</div>
									<p className="mt-1 text-[12px]" style={{ color: "var(--maxxi-muted)" }}>
										Prova: {item.sourceSystem}:{item.sourceRecordId}
									</p>
									<p className="mt-1 text-[12.5px]">{item.reason}</p>
									<p className="mt-1 text-[11.5px]" style={{ color: "var(--maxxi-muted)" }}>
										{item.matches.length} profili esistenti con nome o email simile
									</p>
								</div>
								<button type="button" onClick={() => openCase(item)} className="maxxi-secondary-action">
									Confronta
								</button>
							</li>
						))}
					</ul>
				)}
			</Card>
			)}

			{canSeePeople && selected && (
				<Card>
					<SectionTitle hint="La decisione viene registrata e auditata; nessuna riga persona viene modificata">
						Confronto: {selected.name}
					</SectionTitle>
					<div className="grid grid-cols-1 gap-3 md:grid-cols-2">
						<div className="border p-3" style={{ borderColor: "var(--maxxi-line)" }}>
							<p className="maxxi-eyebrow">Record in revisione</p>
							<p className="mt-1 text-[13px] font-semibold">{selected.name}</p>
							<p className="text-[11.5px]" style={{ color: "var(--maxxi-muted)" }}>{selected.email}</p>
							<p className="mt-2 text-[11.5px]" style={{ color: "var(--maxxi-muted)" }}>
								{selected.sourceSystem}:{selected.sourceRecordId}
							</p>
							<p className="mt-2 text-[12px]">{selected.reason}</p>
						</div>
						<div className="border p-3" style={{ borderColor: "var(--maxxi-line)" }}>
							<p className="maxxi-eyebrow">Profili esistenti</p>
							{selected.matches.length === 0 ? (
								<p className="mt-2 text-[12px]" style={{ color: "var(--maxxi-muted)" }}>
									Nessun profilo con nome o email corrispondente.
								</p>
							) : (
								<ul className="mt-2 divide-y" style={{ borderColor: "var(--maxxi-line)" }}>
									{selected.matches.map((match) => (
										<li key={match.personId} className="py-2">
											<a href={`/maxxi/people?id=${encodeURIComponent(match.personId)}`} className="text-[12.5px] font-semibold underline-offset-2 hover:underline">
												{match.name}
											</a>
											<p className="text-[11.5px]" style={{ color: "var(--maxxi-muted)" }}>
												{match.email} · {match.links} fonti · {match.memberships} card · {match.personId}
											</p>
										</li>
									))}
								</ul>
							)}
						</div>
					</div>

					{selected.decision && (
						<p className="mt-3 border-t pt-3 text-[12px]" style={{ borderColor: "var(--maxxi-line)" }}>
							Decisione già registrata: <strong>{selected.decision.decision === "keep_separate" ? "mantieni separati" : "unione simulata"}</strong>
							{" · "}{selected.decision.decidedBy} · {formatDate(selected.decision.decidedAt)}
							<span className="block text-[11.5px]" style={{ color: "var(--maxxi-muted)" }}>
								Motivo: {selected.decision.reason}
							</span>
						</p>
					)}

					{canReview ? (
						<div className="mt-4 border-t pt-4" style={{ borderColor: "var(--maxxi-line)" }}>
							<div className="flex flex-wrap gap-2">
								<button
									type="button"
									onClick={() => setDecision("keep_separate")}
									className="maxxi-secondary-action"
									style={decision === "keep_separate" ? { background: "var(--maxxi-ink)", color: "#fff" } : undefined}
								>
									Mantieni separati
								</button>
								<button
									type="button"
									onClick={() => setDecision("merge_simulated")}
									className="maxxi-secondary-action"
									style={decision === "merge_simulated" ? { background: "var(--maxxi-ink)", color: "#fff" } : undefined}
								>
									Unisci (simulato)
								</button>
							</div>
							<label className="mt-3 flex flex-col gap-1.5">
								<span className="maxxi-eyebrow">Motivazione (min. 5 caratteri)</span>
								<textarea
									value={reason}
									onChange={(event) => setReason(event.target.value)}
									className="maxxi-input min-h-[90px]"
									maxLength={500}
								/>
							</label>
							<button
								type="button"
								onClick={() => void submitDecision()}
								disabled={saving || reason.trim().length < 5}
								className="maxxi-primary-action mt-3"
							>
								{saving ? "Registrazione…" : "Registra decisione simulata"}
							</button>
							<p className="mt-2 text-[11px]" style={{ color: "var(--maxxi-muted)" }}>
								Anche “Unisci” è solo una decisione registrata: nessuna fusione viene applicata al database.
							</p>
						</div>
					) : (
						<p className="mt-3 text-[12px]" style={{ color: "var(--maxxi-muted)" }}>
							Solo un amministratore può registrare la decisione.
						</p>
					)}
				</Card>
			)}
		</div>
	);
}
