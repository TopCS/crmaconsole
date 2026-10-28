"use client";

import { useEffect, useState } from "react";
import { Badge, Card, DemoNote, Empty, ErrorNote, Loading, SectionTitle } from "../ui";

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
	if (!data) {return <Loading />;}

	return (
		<div className="space-y-4">
			<SectionTitle hint="Ogni fonte dichiara se il connettore è reale o simulato">
				Fonti e qualità del dato
			</SectionTitle>

			<Card>
				{data.sources.length === 0 ? (
					<Empty>Nessuna fonte registrata.</Empty>
				) : (
					<ul className="divide-y" style={{ borderColor: "var(--color-border)" }}>
						{data.sources.map((source) => (
							<li key={source.sourceSystem} className="py-3">
								<div className="flex flex-wrap items-center justify-between gap-2">
									<span className="font-medium" style={{ color: "var(--color-text)" }}>{source.sourceSystem}</span>
									<span className="flex items-center gap-2">
										<Badge tone={source.mockOrLive === "mock" ? "warn" : "ok"}>
											{source.mockOrLive === "mock" ? "connettore demo simulato" : "integrazione reale"}
										</Badge>
										<Badge tone={source.status === "ok" ? "ok" : "bad"}>{source.status}</Badge>
									</span>
								</div>
								<p className="mt-1 text-xs" style={{ color: "var(--color-text-muted)" }}>{source.description}</p>
								<p className="mt-1 text-[11px]" style={{ color: "var(--color-text-muted)" }}>
									{source.rowCount} righe importate · {source.unmatchedCount} non attribuite ·{" "}
									{source.quarantinedCount} da revisionare · ultimo import{" "}
									{source.lastImportedAt ? source.lastImportedAt.slice(0, 10) : "—"}
								</p>
							</li>
						))}
					</ul>
				)}
			</Card>

			<Card>
				<SectionTitle hint="Record non uniti automaticamente">Coda di revisione identità</SectionTitle>
				{data.reviews.length === 0 ? (
					<Empty>Nessun candidato in revisione.</Empty>
				) : (
					<ul className="space-y-2">
						{data.reviews.map((review) => (
							<li key={review.candidateId} className="rounded-lg border p-3 text-sm" style={{ borderColor: "var(--color-border)" }}>
								<div className="flex flex-wrap items-center gap-2">
									<span style={{ color: "var(--color-text)" }}>{review.name}</span>
									<span className="text-xs" style={{ color: "var(--color-text-muted)" }}>{review.email}</span>
									<Badge tone="warn">{review.status}</Badge>
								</div>
								<p className="mt-1 text-[11px]" style={{ color: "var(--color-text-muted)" }}>
									{review.sourceSystem}:{review.sourceRecordId} — {review.reason}
								</p>
							</li>
						))}
					</ul>
				)}
			</Card>

			<DemoNote>
				I tracciati XLS/CSV sono inventati per la demo: non riproducono il formato dei fornitori reali
				(Archeoares, biblioteca, infopoint). Nessuna integrazione con WordPress, Matomo o biglietteria è attiva.
			</DemoNote>
		</div>
	);
}
