"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Badge, Card, DemoNote, Empty, ErrorNote, Kpi, Loading, SectionTitle } from "./ui";

type Overview = {
	banner: string;
	clock: string;
	kpis: Record<string, number | string | null>;
	sources: Array<{ sourceSystem: string; mockOrLive: string; rowCount: number; quarantinedCount: number }>;
	reviews: Array<{ candidateId: string; name: string; email: string; reason: string }>;
};

export default function MaxxiDashboard() {
	const [data, setData] = useState<Overview | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [seeding, setSeeding] = useState(false);

	const load = useCallback(async () => {
		setError(null);
		try {
			const res = await fetch("/api/maxxi/overview", { cache: "no-store" });
			const body = (await res.json()) as Overview & { error?: string };
			if (!res.ok) {throw new Error(body.error ?? `HTTP ${res.status}`);}
			setData(body);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Caricamento fallito.");
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	async function seed() {
		setSeeding(true);
		setError(null);
		try {
			const res = await fetch("/api/maxxi/seed", { method: "POST" });
			const body = (await res.json()) as { error?: string };
			if (!res.ok) {throw new Error(body.error ?? `HTTP ${res.status}`);}
			await load();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Seed fallito.");
		} finally {
			setSeeding(false);
		}
	}

	if (error) {return <ErrorNote>{error}</ErrorNote>;}
	if (!data) {return <Loading />;}

	const k = data.kpis;

	return (
		<div className="space-y-6">
			<div className="flex flex-wrap items-end justify-between gap-3">
				<SectionTitle hint={`Orologio demo fisso: ${data.clock}`}>Panoramica del pubblico</SectionTitle>
				<button
					type="button"
					onClick={seed}
					disabled={seeding}
					className="rounded-lg border px-3 py-1.5 text-xs font-medium disabled:opacity-60"
					style={{ borderColor: "var(--color-border)", color: "var(--color-text)" }}
					title="Ricostruisce il dataset demo dai fixture (idempotente)"
				>
					{seeding ? "Seed…" : "Ricarica dati demo"}
				</button>
			</div>

			<div className="grid grid-cols-2 gap-3 md:grid-cols-4">
				<Kpi label="Persone identificate" value={k.identifiedPeople} hint="Persone univoche, non accessi né biglietti anonimi" />
				<Kpi label="Con fonti collegate" value={k.linkedPeople} hint="Almeno un identificativo di origine verificato" />
				<Kpi label="Eventi anonimi" value={k.anonymousSubjects} hint="Non attribuiti a una persona" />
				<Kpi label="Eventi totali" value={k.totalEvents} />
				<Kpi label="Visite attribuite" value={k.attendedVisits} hint="Solo presenze verificate, non acquisti" />
				<Kpi label="Acquisti biglietto" value={k.purchases} hint="Un acquisto non implica la visita" />
				<Kpi label="myMAXXI in scadenza (45g)" value={k.membershipsExpiring45d} />
				<Kpi label="myMAXXI scadute" value={k.membershipsExpired} />
				<Kpi label="Feedback aperti" value={k.openFeedback} />
				<Kpi label="Da revisionare" value={k.pendingReviews} hint="Omonimi / identità incerte" />
				<Kpi label="Fonti registrate" value={k.sources} hint="Tutte simulate" />
			</div>

			<Card>
				<SectionTitle hint="Ogni fonte dichiara se è un connettore demo simulato">Fonti e qualità del dato</SectionTitle>
				<ul className="divide-y" style={{ borderColor: "var(--color-border)" }}>
					{data.sources.map((source) => (
						<li key={source.sourceSystem} className="flex items-center justify-between gap-3 py-2 text-sm">
							<span style={{ color: "var(--color-text)" }}>{source.sourceSystem}</span>
							<span className="flex items-center gap-2 text-xs" style={{ color: "var(--color-text-muted)" }}>
								<span>{source.rowCount} righe</span>
								{source.quarantinedCount > 0 && <Badge tone="warn">{source.quarantinedCount} da rivedere</Badge>}
								<Badge tone={source.mockOrLive === "mock" ? "warn" : "ok"}>{source.mockOrLive}</Badge>
							</span>
						</li>
					))}
					{data.sources.length === 0 && <Empty>Nessuna fonte: esegui il seed demo.</Empty>}
				</ul>
			</Card>

			<Card>
				<SectionTitle hint="Record non uniti automaticamente: serve una verifica umana">Revisione identità</SectionTitle>
				{data.reviews.length === 0 ? (
					<Empty>Nessun candidato in revisione.</Empty>
				) : (
					<ul className="space-y-2">
						{data.reviews.map((review) => (
							<li key={review.candidateId} className="rounded-lg border p-3 text-sm" style={{ borderColor: "var(--color-border)" }}>
								<div className="flex flex-wrap items-center gap-2">
									<span className="font-medium" style={{ color: "var(--color-text)" }}>{review.name}</span>
									<span className="text-xs" style={{ color: "var(--color-text-muted)" }}>{review.email}</span>
									<Badge tone="warn">da revisionare</Badge>
								</div>
								<p className="mt-1 text-xs" style={{ color: "var(--color-text-muted)" }}>{review.reason}</p>
							</li>
						))}
					</ul>
				)}
			</Card>

			<Card>
				<SectionTitle>Percorsi demo</SectionTitle>
				<div className="grid gap-2 text-sm md:grid-cols-3">
					<Link className="rounded-lg border p-3" style={{ borderColor: "var(--color-border)", color: "var(--color-text)" }} href="/maxxi/people?id=P-MARIA">
						1 · Dal frammento alla persona
						<DemoNote>Tre fonti → un profilo, omonimo in revisione, ticket anonimo non attribuito.</DemoNote>
					</Link>
					<Link className="rounded-lg border p-3" style={{ borderColor: "var(--color-border)", color: "var(--color-text)" }} href="/maxxi/segments">
						2 · Segmento e proposta
						<DemoNote>Audience deterministica, esclusioni per consenso, bozza in dry-run.</DemoNote>
					</Link>
					<Link className="rounded-lg border p-3" style={{ borderColor: "var(--color-border)", color: "var(--color-text)" }} href="/maxxi/people?id=P-GIULIA">
						3 · Membership, feedback, relazioni
						<DemoNote>Card in scadenza, richiesta infopoint, organizzazione sostenitrice.</DemoNote>
					</Link>
				</div>
			</Card>
		</div>
	);
}
