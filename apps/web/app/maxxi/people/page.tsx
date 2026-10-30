"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Badge, Card, DemoNote, Empty, ErrorNote, Loading, PageHeader, SectionTitle } from "../ui";
import { StepBrief } from "../flow";

type PersonListItem = {
	id: string;
	name: string;
	email: string;
	interests: string[];
	links: number;
	memberships: number;
	lastEventAt: string | null;
};

type Person360 = {
	person: { id: string; name: string; email: string; language: string; interestsExplicit: string[] };
	identityLinks: Array<{ sourceSystem: string; sourceRecordId: string; matchMethod: string; confidence: number; status: string; matchedAt: string | null }>;
	reviewCandidates: Array<{ candidateId: string; name: string; email: string; reason: string; status: string }>;
	timeline: Array<{ eventId: string; type: string; occurredAt: string; sourceSystem: string; sourceRecordId: string; catalogItemId: string | null }>;
	memberships: Array<{ membershipId: string; cardCode: string; product: string; validFrom: string; validTo: string; status: string; sourceSystem: string }>;
	consents: Array<{ purpose: string; channel: string; status: string; capturedAt: string | null; sourceSystem: string; sourceRecordId: string }>;
	feedback: Array<{ caseId: string; channel: string; category: string; status: string; openedAt: string; summary: string }>;
	organizations: Array<{ organizationId: string; name: string; type: string }>;
	dataQuality: { hasProvenance: boolean; identityIsCertain: boolean; notes: string[] };
};

const EVENT_LABEL: Record<string, string> = {
	form_submitted: "Modulo inviato",
	museum_visit_attended: "Visita effettiva",
	exhibition_ticket_purchased: "Acquisto biglietto",
	library_checkin: "Accesso biblioteca",
	feedback_submitted: "Feedback infopoint",
	newsletter_consent_granted: "Consenso newsletter",
	membership_activated: "Membership attivata",
};

const CONSENT_LABEL: Record<string, string> = {
	granted: "Concesso",
	withdrawn: "Revocato",
	unknown: "Non noto",
};

const MEMBERSHIP_LABEL: Record<string, string> = {
	active: "Attiva",
	expiring: "In scadenza",
	expired: "Scaduta",
	not_linked: "Non associata",
};

export default function PeoplePage() {
	return (
		<Suspense fallback={<Loading label="Caricamento visitatori…" />}>
			<PeopleInner />
		</Suspense>
	);
}

function PeopleInner() {
	const params = useSearchParams();
	const router = useRouter();
	const selectedId = params.get("id");
	const q = params.get("q") ?? "";
	const [search, setSearch] = useState(q);
	const [people, setPeople] = useState<PersonListItem[]>([]);
	const [person, setPerson] = useState<Person360 | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);

	const load = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			if (selectedId) {
				const res = await fetch(`/api/maxxi/people?id=${encodeURIComponent(selectedId)}`, { cache: "no-store" });
				const body = (await res.json()) as { person?: Person360; error?: string };
				if (!res.ok || !body.person) {throw new Error(body.error ?? `HTTP ${res.status}`);}
				setPerson(body.person);
			} else {
				const query = q ? `?q=${encodeURIComponent(q)}` : "";
				const res = await fetch(`/api/maxxi/people${query}`, { cache: "no-store" });
				const body = (await res.json()) as { people?: PersonListItem[]; error?: string };
				if (!res.ok) {throw new Error(body.error ?? `HTTP ${res.status}`);}
				setPeople(body.people ?? []);
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : "Caricamento fallito.");
		} finally {
			setLoading(false);
		}
	}, [selectedId, q]);

	useEffect(() => {
		void load();
	}, [load]);

	useEffect(() => {
		setSearch(q);
	}, [q]);

	const applySearch = useCallback(
		(value: string) => {
			const next = new URLSearchParams(params.toString());
			const trimmed = value.trim();
			if (trimmed) {next.set("q", trimmed);} else {next.delete("q");}
			next.delete("id");
			const qs = next.toString();
			router.replace(`/maxxi/people${qs ? `?${qs}` : ""}`, { scroll: false });
		},
		[params, router],
	);

	useEffect(() => {
		const timer = setTimeout(() => {
			if (search !== q) {applySearch(search);}
		}, 250);
		return () => clearTimeout(timer);
	}, [search, q, applySearch]);

	if (error) {return <ErrorNote>{error}</ErrorNote>;}
	if (loading) {return <Loading label="Caricamento visitatori…" />;}
	if (selectedId && person) {return <Profile360 person={person} />;}

	return (
		<div className="space-y-4">
			<PageHeader
				eyebrow="Pubblico / Visitatori"
				title="Profili 360"
				subtitle="Persone univoche del dataset dimostrativo. Ogni profilo conserva la provenienza dei record e distingue visite, acquisti e consensi."
				actions={
					<form
						role="search"
						onSubmit={(event) => { event.preventDefault(); applySearch(search); }}
						className="flex w-full max-w-sm gap-2"
					>
						<input
							type="search"
							value={search}
							onChange={(event) => setSearch(event.target.value)}
							placeholder="Cerca nome, email o ID…"
							aria-label="Cerca visitatori per nome, email o ID"
							className="maxxi-input"
						/>
						<button type="submit" className="maxxi-secondary-action">
							Cerca
						</button>
					</form>
				}
			/>

			<StepBrief
				step={0}
				question="Chi c'è dietro un'iscrizione?"
				evidence={`${people.length} profili univoci nel dataset demo · ogni riga conserva le fonti di origine`}
				next={{ href: "/maxxi/people?id=P-MARIA", label: "Apri Maria Rossi" }}
			/>

			{q && (
				<p className="text-[12px]" role="status" style={{ color: "var(--maxxi-muted)" }}>
					Risultati per “{q}”: {people.length}
				</p>
			)}

			<Card className="p-0">
				{people.length === 0 ? (
					<Empty>
						{q
							? `Nessun visitatore trovato per “${q}”.`
							: "Nessuna persona: esegui il seed demo dalla Panoramica."}
					</Empty>
				) : (
					<div className="maxxi-table-scroll">
						<table className="maxxi-table">
							<caption className="sr-only">Elenco delle persone identificate</caption>
							<thead>
								<tr>
									<th scope="col">Persona</th>
									<th scope="col">Interessi</th>
									<th scope="col" className="num">Fonti</th>
									<th scope="col" className="num">Card</th>
									<th scope="col">Ultimo evento</th>
								</tr>
							</thead>
							<tbody>
								{people.map((item) => (
									<tr key={item.id}>
										<th scope="row">
											<Link
												href={`/maxxi/people?id=${encodeURIComponent(item.id)}`}
												className="font-medium underline-offset-2 hover:underline"
											>
												{item.name}
											</Link>
											<span className="mt-0.5 block text-[12px] font-normal" style={{ color: "var(--maxxi-muted)" }}>
												{item.email}
											</span>
										</th>
										<td>
											{item.interests.length === 0 ? (
												<span style={{ color: "var(--maxxi-muted)" }}>—</span>
											) : (
												<span className="flex flex-wrap gap-1.5">
													{item.interests.map((interest) => (
														<span
															key={interest}
															className="border px-1.5 py-0.5 text-[11px]"
															style={{ borderColor: "var(--maxxi-line-strong)" }}
														>
															{interest}
														</span>
													))}
												</span>
											)}
										</td>
										<td className="num">{item.links}</td>
										<td className="num">{item.memberships}</td>
										<td className="text-[12.5px]" style={{ color: "var(--maxxi-muted)" }}>
											{item.lastEventAt ? item.lastEventAt.slice(0, 10) : "—"}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</Card>

			<DemoNote>Dati sintetici. Nessuna persona elencata corrisponde a un visitatore reale del museo.</DemoNote>
		</div>
	);
}

function Profile360({ person }: { person: Person360 }) {
	const certain = person.dataQuality.identityIsCertain;

	return (
		<div className="space-y-6">
			<PageHeader
				eyebrow="Pubblico / Visitatore 360"
				title={person.person.name}
				subtitle={`${person.person.email} · lingua ${person.person.language}`}
				actions={
					<>
						<Badge tone={certain ? "ok" : "warn"}>
							{certain ? "Identità verificata" : "Identità da verificare"}
						</Badge>
						<Link
							href={`/maxxi/graph?focus=${encodeURIComponent(person.person.id)}&depth=2`}
							className="maxxi-secondary-action"
						>
							Vedi relazioni
						</Link>
						<Link href="/maxxi/people" className="maxxi-secondary-action">
							Tutti i visitatori
						</Link>
					</>
				}
			/>

			<StepBrief
				step={0}
				question="Chi è Maria e da quali fonti lo sappiamo?"
				evidence={`${person.identityLinks.length} fonti collegate · ${person.memberships.length} card · ${person.consents.filter((consent) => consent.status === "granted").length} consensi attivi · ${person.timeline.length} eventi attribuiti`}
				next={{
					href: `/maxxi/graph?focus=${encodeURIComponent(person.person.id)}&depth=2`,
					label: "Apri il grafo",
				}}
			/>

			<div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
				<div className="space-y-5 lg:col-span-2">
					<Card>
						<SectionTitle hint="Ogni riga mostra la fonte e l'ID del record originale">
							Timeline
						</SectionTitle>
						{person.timeline.length === 0 ? (
							<Empty>Nessun evento attribuito.</Empty>
						) : (
							<ol className="divide-y" style={{ borderColor: "var(--maxxi-line)" }}>
								{person.timeline.map((event) => (
									<li key={event.eventId} className="grid grid-cols-1 gap-2 py-3 sm:grid-cols-[92px_1fr]">
										<span className="text-[12px] tabular-nums" style={{ color: "var(--maxxi-muted)" }}>
											{event.occurredAt.slice(0, 10)}
										</span>
										<div className="min-w-0">
											<div className="flex flex-wrap items-center gap-2">
												<strong className="text-[13.5px] font-semibold">
													{EVENT_LABEL[event.type] ?? event.type}
												</strong>
												{event.catalogItemId && (
													<span className="text-[11.5px]" style={{ color: "var(--maxxi-muted)" }}>
														{event.catalogItemId}
													</span>
												)}
											</div>
											<p className="mt-1 break-words text-[11px]" style={{ color: "var(--maxxi-muted)" }}>
												{event.sourceSystem}:{event.sourceRecordId}
											</p>
										</div>
									</li>
								))}
							</ol>
						)}
					</Card>

					<Card>
						<SectionTitle hint="Da quale sistema arriva ogni identificativo">
							Identità di origine
						</SectionTitle>
						{person.identityLinks.length === 0 ? (
							<Empty>Nessun identificativo collegato.</Empty>
						) : (
							<div className="maxxi-table-scroll">
								<table className="maxxi-table">
									<caption className="sr-only">Record di origine collegati al profilo</caption>
									<thead>
										<tr>
											<th scope="col">Fonte</th>
											<th scope="col">Record</th>
											<th scope="col">Regola</th>
											<th scope="col" className="num">Confidenza</th>
										</tr>
									</thead>
									<tbody>
										{person.identityLinks.map((link) => (
											<tr key={`${link.sourceSystem}:${link.sourceRecordId}`}>
												<th scope="row">{link.sourceSystem}</th>
												<td>{link.sourceRecordId}</td>
												<td>{link.matchMethod}</td>
												<td className="num">{link.confidence.toFixed(2)}</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						)}
						<details className="mt-3 border-t pt-3" style={{ borderColor: "var(--maxxi-line)" }}>
							<summary className="cursor-pointer text-[12px] font-semibold">
								Perché questi record sono collegati?
							</summary>
							<ul className="mt-2 space-y-1 text-[11.5px]" style={{ color: "var(--maxxi-muted)" }}>
								{person.identityLinks.map((link) => (
									<li key={`why-${link.sourceSystem}:${link.sourceRecordId}`}>
										{link.sourceSystem} · regola {link.matchMethod} · confidenza {link.confidence.toFixed(2)}
										{link.matchedAt ? ` · verificato il ${link.matchedAt.slice(0, 10)}` : ""}
									</li>
								))}
								{person.identityLinks.length === 0 && <li>Nessun collegamento registrato.</li>}
							</ul>
						</details>
					</Card>
				</div>

				<div className="space-y-5">
					<Card>
						<SectionTitle hint="Acquisto ≠ presenza effettiva">myMAXXI</SectionTitle>
						{person.memberships.length === 0 ? (
							<Empty>Nessuna card.</Empty>
						) : (
							<ul className="divide-y" style={{ borderColor: "var(--maxxi-line)" }}>
								{person.memberships.map((membership) => (
									<li key={membership.membershipId} className="py-3">
										<div className="flex items-start justify-between gap-2">
											<strong className="text-[13.5px]">{membership.product}</strong>
											<Badge tone={membership.status === "active" ? "ok" : membership.status === "expired" ? "bad" : "warn"}>
												{MEMBERSHIP_LABEL[membership.status] ?? membership.status}
											</Badge>
										</div>
										<p className="mt-1 text-[11.5px]" style={{ color: "var(--maxxi-muted)" }}>
											{membership.cardCode} · {membership.validFrom} → {membership.validTo}
										</p>
										<p className="text-[11px]" style={{ color: "var(--maxxi-muted)" }}>
											fonte {membership.sourceSystem}
										</p>
									</li>
								))}
							</ul>
						)}
					</Card>

					<Card>
						<SectionTitle hint="Per finalità e canale, non un flag unico">Consensi</SectionTitle>
						{person.consents.length === 0 ? (
							<Empty>Nessun consenso registrato.</Empty>
						) : (
							<ul className="divide-y" style={{ borderColor: "var(--maxxi-line)" }}>
								{person.consents.map((consent) => (
									<li key={`${consent.purpose}:${consent.channel}`} className="flex items-center justify-between gap-2 py-2.5">
										<span className="text-[12.5px]">
											{consent.purpose} / {consent.channel}
										</span>
										<Badge tone={consent.status === "granted" ? "ok" : consent.status === "withdrawn" ? "bad" : "warn"}>
											{CONSENT_LABEL[consent.status] ?? consent.status}
										</Badge>
									</li>
								))}
							</ul>
						)}
					</Card>

					<Card>
						<SectionTitle hint="Dichiarati nel profilo, non inferiti">Interessi</SectionTitle>
						{person.person.interestsExplicit.length === 0 ? (
							<Empty>Nessun interesse dichiarato.</Empty>
						) : (
							<ul className="flex flex-wrap gap-1.5">
								{person.person.interestsExplicit.map((interest) => (
									<li
										key={interest}
										className="border px-2 py-1 text-[11.5px]"
										style={{ borderColor: "var(--maxxi-line-strong)" }}
									>
										{interest}
									</li>
								))}
							</ul>
						)}
					</Card>

					<Card>
						<SectionTitle>Organizzazioni</SectionTitle>
						{person.organizations.length === 0 ? (
							<Empty>Nessuna relazione con organizzazioni.</Empty>
						) : (
							<ul className="divide-y" style={{ borderColor: "var(--maxxi-line)" }}>
								{person.organizations.map((org) => (
									<li key={org.organizationId} className="flex items-center justify-between gap-2 py-2.5">
										<span className="text-[12.5px]">{org.name}</span>
										<Badge tone="neutral">{org.type}</Badge>
									</li>
								))}
							</ul>
						)}
					</Card>

					<Card>
						<SectionTitle>Qualità del dato</SectionTitle>
						<p className="text-[12.5px]">
							Provenienza:{" "}
							<strong>{person.dataQuality.hasProvenance ? "presente" : "assente"}</strong>
						</p>
						{person.dataQuality.notes.length > 0 && (
							<ul className="mt-2 list-disc space-y-1 pl-4 text-[11.5px]" style={{ color: "var(--maxxi-muted)" }}>
								{person.dataQuality.notes.map((note) => (
									<li key={note}>{note}</li>
								))}
							</ul>
						)}
					</Card>
				</div>
			</div>

			{person.feedback.length > 0 && (
				<Card>
					<SectionTitle hint="Visibile solo ai ruoli con accesso alle note infopoint">
						Infopoint e feedback
					</SectionTitle>
					<ul className="divide-y" style={{ borderColor: "var(--maxxi-line)" }}>
						{person.feedback.map((feedback) => (
							<li key={feedback.caseId} className="py-3">
								<div className="flex flex-wrap items-center gap-2">
									<Badge tone={feedback.status === "open" ? "warn" : "ok"}>
										{feedback.status === "open" ? "Aperto" : "Chiuso"}
									</Badge>
									<strong className="text-[13px]">{feedback.category}</strong>
									<span className="text-[11.5px]" style={{ color: "var(--maxxi-muted)" }}>
										{feedback.openedAt.slice(0, 10)}
									</span>
								</div>
								<p className="mt-1 text-[12px]" style={{ color: "var(--maxxi-muted)" }}>
									{feedback.summary}
								</p>
							</li>
						))}
					</ul>
				</Card>
			)}

			{person.reviewCandidates.length > 0 && (
				<Card>
					<SectionTitle hint="Record simile non unito automaticamente: la decisione si prende nella coda di revisione.">
						Possibile duplicato
					</SectionTitle>
					<ul className="divide-y" style={{ borderColor: "var(--maxxi-line)" }}>
						{person.reviewCandidates.map((candidate) => (
							<li key={candidate.candidateId} className="py-3">
								<div className="flex flex-wrap items-center gap-2">
									<strong className="text-[13px]">{candidate.name}</strong>
									<span className="text-[11.5px]" style={{ color: "var(--maxxi-muted)" }}>
										{candidate.email}
									</span>
									<Badge tone="warn">Da verificare</Badge>
								</div>
								<p className="mt-1 text-[12px]" style={{ color: "var(--maxxi-muted)" }}>
									{candidate.reason}
								</p>
							</li>
						))}
					</ul>
					<Link href="/maxxi/sources" className="maxxi-secondary-action mt-3">
						Apri coda di revisione
					</Link>
				</Card>
			)}
		</div>
	);
}
