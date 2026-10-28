"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Badge, Card, DemoNote, Empty, ErrorNote, Loading, SectionTitle } from "../ui";

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
	feedback_submitted: "Feedback infospoint",
	newsletter_consent_granted: "Consenso newsletter",
	membership_activated: "Membership attivata",
};

export default function PeoplePage() {
	return (
		<Suspense fallback={<Loading />}>
			<PeopleInner />
		</Suspense>
	);
}

function PeopleInner() {
	const params = useSearchParams();
	const selectedId = params.get("id");
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
				const res = await fetch("/api/maxxi/people", { cache: "no-store" });
				const body = (await res.json()) as { people?: PersonListItem[]; error?: string };
				if (!res.ok) {throw new Error(body.error ?? `HTTP ${res.status}`);}
				setPeople(body.people ?? []);
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : "Caricamento fallito.");
		} finally {
			setLoading(false);
		}
	}, [selectedId]);

	useEffect(() => {
		void load();
	}, [load]);

	if (error) {return <ErrorNote>{error}</ErrorNote>;}
	if (loading) {return <Loading />;}
	if (selectedId && person) {return <Profile360 person={person} />;}

	return (
		<div className="space-y-4">
			<SectionTitle hint="Persone univoche del dataset dimostrativo">Visitatori</SectionTitle>
			<Card>
				{people.length === 0 ? (
					<Empty>Nessuna persona: esegui il seed demo dalla Panoramica.</Empty>
				) : (
					<ul className="divide-y" style={{ borderColor: "var(--color-border)" }}>
						{people.map((item) => (
							<li key={item.id} className="py-2">
								<a
									href={`/maxxi/people?id=${encodeURIComponent(item.id)}`}
									className="flex flex-wrap items-center justify-between gap-2 text-sm hover:opacity-80"
								>
									<span className="flex flex-wrap items-center gap-2">
										<span className="font-medium" style={{ color: "var(--color-text)" }}>{item.name}</span>
										<span className="text-xs" style={{ color: "var(--color-text-muted)" }}>{item.email}</span>
										{item.interests.map((interest) => (
											<Badge key={interest} tone="neutral">{interest}</Badge>
										))}
									</span>
									<span className="flex items-center gap-2 text-xs" style={{ color: "var(--color-text-muted)" }}>
										<span>{item.links} fonti</span>
										<span>{item.memberships} card</span>
										{item.lastEventAt && <span>ultimo evento {item.lastEventAt.slice(0, 10)}</span>}
									</span>
								</a>
							</li>
						))}
					</ul>
				)}
			</Card>
			<DemoNote>Dati sintetici. Nessuna persona elencata corrisponde a un visitatore reale del museo.</DemoNote>
		</div>
	);
}

function Profile360({ person }: { person: Person360 }) {
	return (
		<div className="space-y-4">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<SectionTitle hint={`${person.person.email} · lingua ${person.person.language}`}>
					{person.person.name}
				</SectionTitle>
				<Badge tone={person.dataQuality.identityIsCertain ? "ok" : "warn"}>
					{person.dataQuality.identityIsCertain ? "identità verificata" : "identità da verificare"}
				</Badge>
			</div>

			<div className="grid gap-3 md:grid-cols-2">
				<Card>
					<SectionTitle hint="Da quale sistema arriva ogni identificativo">Identità di origine</SectionTitle>
					{person.identityLinks.length === 0 ? (
						<Empty>Nessun identificativo collegato.</Empty>
					) : (
						<ul className="space-y-2 text-sm">
							{person.identityLinks.map((link) => (
								<li key={`${link.sourceSystem}:${link.sourceRecordId}`} className="flex flex-wrap items-center justify-between gap-2">
									<span style={{ color: "var(--color-text)" }}>{link.sourceSystem}</span>
									<span className="text-xs" style={{ color: "var(--color-text-muted)" }}>
										{link.sourceRecordId} · regola {link.matchMethod} · confidenza {link.confidence.toFixed(2)}
									</span>
								</li>
							))}
						</ul>
					)}
				</Card>

				<Card>
					<SectionTitle hint="Consenso per scopo e canale, non un flag unico">Consensi</SectionTitle>
					{person.consents.length === 0 ? (
						<Empty>Nessun consenso registrato.</Empty>
					) : (
						<ul className="space-y-2 text-sm">
							{person.consents.map((consent) => (
								<li key={`${consent.purpose}:${consent.channel}`} className="flex items-center justify-between gap-2">
									<span style={{ color: "var(--color-text)" }}>
										{consent.purpose} / {consent.channel}
									</span>
									<Badge tone={consent.status === "granted" ? "ok" : consent.status === "withdrawn" ? "bad" : "warn"}>
										{consent.status}
									</Badge>
								</li>
							))}
						</ul>
					)}
				</Card>

				<Card>
					<SectionTitle hint="Acquisto ≠ presenza effettiva">Membership</SectionTitle>
					{person.memberships.length === 0 ? (
						<Empty>Nessuna card.</Empty>
					) : (
						<ul className="space-y-2 text-sm">
							{person.memberships.map((membership) => (
								<li key={membership.membershipId} className="flex flex-wrap items-center justify-between gap-2">
									<span style={{ color: "var(--color-text)" }}>{membership.product}</span>
									<span className="text-xs" style={{ color: "var(--color-text-muted)" }}>
										{membership.cardCode} · {membership.validFrom} → {membership.validTo}
									</span>
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
						<ul className="space-y-2 text-sm">
							{person.organizations.map((org) => (
								<li key={org.organizationId} className="flex items-center justify-between gap-2">
									<span style={{ color: "var(--color-text)" }}>{org.name}</span>
									<Badge tone="neutral">{org.type}</Badge>
								</li>
							))}
						</ul>
					)}
				</Card>
			</div>

			<Card>
				<SectionTitle hint="Ogni riga mostra la fonte e l'ID del record originale">Timeline</SectionTitle>
				{person.timeline.length === 0 ? (
					<Empty>Nessun evento attribuito.</Empty>
				) : (
					<ul className="space-y-2">
						{person.timeline.map((event) => (
							<li key={event.eventId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2.5 text-sm" style={{ borderColor: "var(--color-border)" }}>
								<span className="flex flex-wrap items-center gap-2">
									<Badge tone={event.type === "museum_visit_attended" ? "ok" : "neutral"}>
										{EVENT_LABEL[event.type] ?? event.type}
									</Badge>
									<span style={{ color: "var(--color-text)" }}>{event.occurredAt.slice(0, 10)}</span>
									{event.catalogItemId && (
										<span className="text-xs" style={{ color: "var(--color-text-muted)" }}>{event.catalogItemId}</span>
									)}
								</span>
								<span className="text-[11px]" style={{ color: "var(--color-text-muted)" }}>
									{event.sourceSystem}:{event.sourceRecordId}
								</span>
							</li>
						))}
					</ul>
				)}
			</Card>

			{person.feedback.length > 0 && (
				<Card>
					<SectionTitle>Infopoint e feedback</SectionTitle>
					<ul className="space-y-2 text-sm">
						{person.feedback.map((feedback) => (
							<li key={feedback.caseId}>
								<div className="flex items-center gap-2">
									<Badge tone={feedback.status === "open" ? "warn" : "ok"}>{feedback.status}</Badge>
									<span style={{ color: "var(--color-text)" }}>{feedback.category}</span>
									<span className="text-xs" style={{ color: "var(--color-text-muted)" }}>{feedback.openedAt.slice(0, 10)}</span>
								</div>
								<p className="mt-1 text-xs" style={{ color: "var(--color-text-muted)" }}>{feedback.summary}</p>
							</li>
						))}
					</ul>
				</Card>
			)}

			{person.reviewCandidates.length > 0 && (
				<Card>
					<SectionTitle hint="Non uniti automaticamente: serve una decisione umana">Candidati in revisione</SectionTitle>
					<ul className="space-y-2 text-sm">
						{person.reviewCandidates.map((candidate) => (
							<li key={candidate.candidateId}>
								<div className="flex flex-wrap items-center gap-2">
									<span style={{ color: "var(--color-text)" }}>{candidate.name}</span>
									<span className="text-xs" style={{ color: "var(--color-text-muted)" }}>{candidate.email}</span>
									<Badge tone="warn">{candidate.status}</Badge>
								</div>
								<p className="mt-1 text-xs" style={{ color: "var(--color-text-muted)" }}>{candidate.reason}</p>
							</li>
						))}
					</ul>
				</Card>
			)}

			{person.dataQuality.notes.length > 0 && (
				<Card>
					<SectionTitle>Note sulla qualità del dato</SectionTitle>
					<ul className="list-disc space-y-1 pl-5 text-xs" style={{ color: "var(--color-text-muted)" }}>
						{person.dataQuality.notes.map((note) => (
							<li key={note}>{note}</li>
						))}
					</ul>
				</Card>
			)}

			<a href="/maxxi/people" className="text-sm underline" style={{ color: "var(--color-accent)" }}>
				← Tutti i visitatori
			</a>
		</div>
	);
}
