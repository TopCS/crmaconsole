"use client";

import { useEffect, useState } from "react";
import { Badge, Card, DemoNote, Empty, ErrorNote, Loading, PageHeader, SectionTitle } from "../ui";

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

export default function SourcesPage() {
	const [data, setData] = useState<Overview | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		void (async () => {
			try {
				const res = await fetch("/api/maxxi/overview", { cache: "no-store" });
				const body = (await res.json()) as Overview & { error?: string };
				if (!res.ok) {throw new Error(body.error ?? `HTTP ${res.status}`);}
				setData(body);
			} catch (err) {
				setError(err instanceof Error ? err.message : "Caricamento fallito.");
			}
		})();
	}, []);

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

			<Card>
				<SectionTitle hint="Nessun merge automatico su nome o email simili">
					Coda di revisione identità
				</SectionTitle>
				{data.reviews.length === 0 ? (
					<Empty>Nessun candidato in revisione.</Empty>
				) : (
					<ul className="divide-y" style={{ borderColor: "var(--maxxi-line)" }}>
						{data.reviews.map((review) => (
							<li key={review.candidateId} className="grid grid-cols-1 gap-3 py-4 md:grid-cols-[1fr_auto]">
								<div>
									<div className="flex flex-wrap items-center gap-2">
										<strong className="text-[13.5px]">{review.name}</strong>
										<span className="text-[11.5px]" style={{ color: "var(--maxxi-muted)" }}>
											{review.email}
										</span>
										<Badge tone="warn">Richiede revisione</Badge>
									</div>
									<p className="mt-1 text-[12px]" style={{ color: "var(--maxxi-muted)" }}>
										Prova: {review.sourceSystem}:{review.sourceRecordId}
									</p>
									<p className="mt-1 text-[12.5px]">{review.reason}</p>
								</div>
								<p className="text-[11px] uppercase tracking-[0.08em] md:text-right" style={{ color: "var(--maxxi-muted)" }}>
									Nessuna azione automatica
								</p>
							</li>
						))}
					</ul>
				)}
			</Card>
		</div>
	);
}
