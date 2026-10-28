"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Badge, Card, DemoNote, Empty, ErrorNote, Kpi, Loading, PageHeader, SectionTitle } from "./ui";
import { hasRole, useMe } from "./use-me";

type ActivityPoint = { month: string; visits: number; events: number };

type Overview = {
	banner: string;
	clock: string;
	kpis: Record<string, number | string | null>;
	sources: Array<{ sourceSystem: string; mockOrLive: string; rowCount: number; quarantinedCount: number }>;
	reviews: Array<{ candidateId: string; name: string; email: string; reason: string }>;
	activity?: ActivityPoint[];
};

const MONTHS = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];

function monthLabel(month: string): string {
	const index = Number(month.slice(5, 7)) - 1;
	return MONTHS[index] ?? month;
}

function ActivityChart({ points }: { points: ActivityPoint[] }) {
	if (points.length === 0) {
		return <Empty>Nessun evento nel dataset demo.</Empty>;
	}

	const width = 640;
	const height = 190;
	const padX = 28;
	const padY = 20;
	const max = Math.max(1, ...points.map((point) => point.visits));
	const step = points.length > 1 ? (width - padX * 2) / (points.length - 1) : 0;
	const coords = points.map((point, index) => ({
		...point,
		x: padX + index * step,
		y: height - padY - (point.visits / max) * (height - padY * 2),
	}));
	const line = coords.map((point) => `${point.x},${point.y}`).join(" ");
	const windowLabel = `${monthLabel(points[0].month)}–${monthLabel(points[points.length - 1].month)} ${points[points.length - 1].month.slice(0, 4)}`;

	return (
		<>
			{/* On narrow screens the 640-wide chart would scale its labels below
			    readable size; show the same data as a compact table instead. */}
			<div className="sm:hidden">
				<ul className="divide-y" style={{ borderColor: "var(--maxxi-line)" }}>
					{points.map((point) => (
						<li key={point.month} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2">
							<span className="text-[12.5px]">
								{monthLabel(point.month)} {point.month.slice(0, 4)}
							</span>
							<span className="text-[11.5px]" style={{ color: "var(--maxxi-muted)" }}>
								<strong className="maxxi-kpi-value text-[15px]" style={{ color: "var(--maxxi-ink)" }}>
									{point.visits}
								</strong>{" "}
								{point.visits === 1 ? "visita" : "visite"} · {point.events} eventi
							</span>
						</li>
					))}
				</ul>
				<p className="mt-2 text-[11px]" style={{ color: "var(--maxxi-muted)" }}>
					Visite effettive attribuite · finestra {windowLabel} · dati dimostrativi
				</p>
			</div>

			<figure className="hidden sm:block" aria-labelledby="maxxi-activity-caption">
			<svg
				viewBox={`0 0 ${width} ${height}`}
				className="h-auto w-full"
				role="img"
				aria-label={`Visite attribuite per mese, ${windowLabel}`}
			>
				<title>Visite attribuite per mese</title>
				<line
					x1={padX}
					x2={width - padX}
					y1={height - padY}
					y2={height - padY}
					stroke="var(--maxxi-line-strong)"
					strokeWidth="1"
				/>
				<polyline
					fill="none"
					stroke="var(--maxxi-ink)"
					strokeWidth="2"
					strokeLinejoin="round"
					strokeLinecap="round"
					points={line}
				/>
				{coords.map((point) => (
					<g key={point.month}>
						<circle cx={point.x} cy={point.y} r="4" fill="var(--maxxi-paper)" stroke="var(--maxxi-ink)" strokeWidth="2" />
						<text
							x={point.x}
							y={point.y - 12}
							textAnchor="middle"
							fontSize="11"
							fontWeight="700"
							fill="var(--maxxi-ink)"
						>
							{point.visits}
						</text>
						<text
							x={point.x}
							y={height - 4}
							textAnchor="middle"
							fontSize="10.5"
							fill="var(--maxxi-muted)"
						>
							{monthLabel(point.month)}
						</text>
					</g>
				))}
			</svg>
			<figcaption id="maxxi-activity-caption" className="mt-2 text-[11px]" style={{ color: "var(--maxxi-muted)" }}>
				Visite effettive attribuite · finestra {windowLabel} · dati dimostrativi
			</figcaption>
			<table className="sr-only">
				<caption>Visite attribuite per mese</caption>
				<thead>
					<tr>
						<th scope="col">Mese</th>
						<th scope="col">Visite</th>
						<th scope="col">Eventi</th>
					</tr>
				</thead>
				<tbody>
					{points.map((point) => (
						<tr key={point.month}>
							<th scope="row">{point.month}</th>
							<td>{point.visits}</td>
							<td>{point.events}</td>
						</tr>
					))}
				</tbody>
			</table>
			</figure>
		</>
	);
}

export default function MaxxiDashboard() {
	const [data, setData] = useState<Overview | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [seeding, setSeeding] = useState(false);
	const { me } = useMe();
	const isAdmin = hasRole(me, "admin");

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
	if (!data) {return <Loading label="Caricamento della panoramica…" />;}

	const k = data.kpis;
	const activity = data.activity ?? [];
	const secondary = [
		{ label: "Persone con fonti collegate", value: k.linkedPeople },
		{ label: "Eventi anonimi", value: k.anonymousSubjects },
		{ label: "Eventi totali", value: k.totalEvents },
		{ label: "Acquisti biglietto", value: k.purchases },
		{ label: "myMAXXI scadute", value: k.membershipsExpired },
		{ label: "Feedback aperti", value: k.openFeedback },
		{ label: "Fonti registrate", value: k.sources },
	];

	return (
		<div className="space-y-8">
			<PageHeader
				eyebrow="Intelligence / Panoramica"
				title="Conoscere il pubblico. Comprendere le relazioni."
				subtitle="Dati dimostrativi integrati da più sistemi, con fonti e qualità verificabili. Nessuna cifra è un dato reale del museo."
				actions={
					isAdmin ? (
						<button
							type="button"
							onClick={seed}
							disabled={seeding}
							className="maxxi-secondary-action"
							title="Ricostruisce il dataset demo dai fixture (idempotente)"
						>
							{seeding ? "Seed…" : "Ricarica dati demo"}
						</button>
					) : undefined
				}
			/>

			<section aria-labelledby="kpi-primary">
				<h2 id="kpi-primary" className="sr-only">
					Indicatori principali
				</h2>
				<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
					<Kpi
						size="primary"
						label="Persone identificate"
						value={k.identifiedPeople}
						hint="Persone univoche, non accessi né biglietti anonimi."
					/>
					<Kpi
						size="primary"
						label="Visite attribuite"
						value={k.attendedVisits}
						hint="Solo presenze verificate, distinte dagli acquisti."
					/>
					<Kpi
						size="primary"
						label="Membership in scadenza"
						value={k.membershipsExpiring45d}
						hint="Card myMAXXI che scadono entro 45 giorni."
					/>
					<Kpi
						size="primary"
						label="Casi da revisionare"
						value={k.pendingReviews}
						hint="Omonimi o identità incerte: serve una decisione umana."
					/>
				</div>
			</section>

			<div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
				<Card>
					<SectionTitle hint="Intervallo del dataset demo, non una serie storica reale">
						Pubblico nel tempo
					</SectionTitle>
					<ActivityChart points={activity} />
				</Card>

				<Card>
					<SectionTitle hint="Ogni fonte dichiara se il connettore è simulato">
						Fonti di acquisizione
					</SectionTitle>
					{data.sources.length === 0 ? (
						<Empty>Nessuna fonte: esegui il seed demo.</Empty>
					) : (
						<div className="maxxi-table-scroll">
							<table className="maxxi-table">
								<caption className="sr-only">Stato delle fonti di acquisizione</caption>
								<thead>
									<tr>
										<th scope="col">Fonte</th>
										<th scope="col">Stato</th>
										<th scope="col" className="num">Record</th>
										<th scope="col" className="num">Da rivedere</th>
									</tr>
								</thead>
								<tbody>
									{data.sources.map((source) => (
										<tr key={source.sourceSystem}>
											<th scope="row" className="font-medium">{source.sourceSystem}</th>
											<td>
												<Badge tone={source.mockOrLive === "mock" ? "warn" : "ok"}>
													{source.mockOrLive === "mock" ? "simulata" : "reale"}
												</Badge>
											</td>
											<td className="num">{source.rowCount}</td>
											<td className="num">{source.quarantinedCount}</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}
					<p className="mt-2 text-[11px] sm:hidden" style={{ color: "var(--maxxi-muted)" }}>
						Scorri la tabella per vedere tutte le colonne.
					</p>
					<DemoNote>Le fonti sono simulate: non esiste alcuna integrazione attiva con biglietteria, biblioteca o myMAXXI.</DemoNote>
				</Card>
			</div>

			<div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-3">
				<Card className="lg:col-span-2">
					<SectionTitle hint="Record non uniti automaticamente: la fusione richiede una verifica umana">
						Revisione identità
					</SectionTitle>
					{data.reviews.length === 0 ? (
						<Empty>Nessun candidato in revisione.</Empty>
					) : (
						<ul className="divide-y" style={{ borderColor: "var(--maxxi-line)" }}>
							{data.reviews.map((review) => (
								<li key={review.candidateId} className="flex flex-wrap items-start justify-between gap-3 py-3">
									<div className="min-w-0">
										<p className="text-sm font-medium">{review.name}</p>
										<p className="text-[12px]" style={{ color: "var(--maxxi-muted)" }}>
											{review.email}
										</p>
										<p className="mt-1 text-[12px]" style={{ color: "var(--maxxi-muted)" }}>
											{review.reason}
										</p>
									</div>
									<Badge tone="warn">Da verificare</Badge>
								</li>
							))}
						</ul>
					)}
				</Card>

				<Card>
					<SectionTitle>Indicatori di contesto</SectionTitle>
					<dl className="divide-y" style={{ borderColor: "var(--maxxi-line)" }}>
						{secondary.map((item) => (
							<div key={item.label} className="flex items-baseline justify-between gap-3 py-2">
								<dt className="text-[12.5px]" style={{ color: "var(--maxxi-muted)" }}>
									{item.label}
								</dt>
								<dd className="maxxi-kpi-value text-[18px]">{item.value}</dd>
							</div>
						))}
					</dl>
					<DemoNote>Orologio demo fisso: {data.clock.slice(0, 16).replace("T", " ")}.</DemoNote>
				</Card>
			</div>

			<section aria-labelledby="percorsi-demo">
				<h2 id="percorsi-demo" className="maxxi-eyebrow mb-3">
					Percorsi demo
				</h2>
				<div className="grid grid-cols-1 gap-3 md:grid-cols-3">
					<Link href="/maxxi/people?id=P-MARIA" className="maxxi-card block p-4 hover:bg-[var(--maxxi-selected)]">
						<p className="maxxi-eyebrow">01 · Identità</p>
						<p className="mt-2 text-[15px] font-semibold">Dal frammento alla persona</p>
						<p className="mt-1 text-[12px] leading-relaxed" style={{ color: "var(--maxxi-muted)" }}>
							Tre fonti → un profilo, un omonimo in revisione, un ticket anonimo non attribuito.
						</p>
					</Link>
					<Link href="/maxxi/segments" className="maxxi-card block p-4 hover:bg-[var(--maxxi-selected)]">
						<p className="maxxi-eyebrow">02 · Attivazione</p>
						<p className="mt-2 text-[15px] font-semibold">Segmento e proposta</p>
						<p className="mt-1 text-[12px] leading-relaxed" style={{ color: "var(--maxxi-muted)" }}>
							Audience deterministica, esclusioni motivate, bozza in dry-run.
						</p>
					</Link>
					<Link href="/maxxi/people?id=P-GIULIA" className="maxxi-card block p-4 hover:bg-[var(--maxxi-selected)]">
						<p className="maxxi-eyebrow">03 · Relazione</p>
						<p className="mt-2 text-[15px] font-semibold">Membership, feedback, relazioni</p>
						<p className="mt-1 text-[12px] leading-relaxed" style={{ color: "var(--maxxi-muted)" }}>
							Card in scadenza, richiesta infopoint, organizzazione sostenitrice.
						</p>
					</Link>
				</div>
			</section>
		</div>
	);
}
