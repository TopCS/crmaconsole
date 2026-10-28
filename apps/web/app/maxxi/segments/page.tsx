"use client";

import { useEffect, useState } from "react";
import { Badge, Card, DemoNote, Empty, ErrorNote, Loading, SectionTitle } from "../ui";

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
	included: "incluso",
	excluded_consent: "escluso: consenso",
	excluded_no_interest: "escluso: interesse",
	excluded_membership_window: "escluso: finestra card",
	excluded_no_interaction: "escluso: nessuna interazione",
	excluded_identity_uncertain: "escluso: identità incerta",
};

export default function SegmentsPage() {
	const [data, setData] = useState<SegmentResponse | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [creating, setCreating] = useState(false);
	const [message, setMessage] = useState<string | null>(null);

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
			setMessage(`Bozza creata (${body.draft.campaignId}) per ${body.draft.counts.eligible} destinatari eleggibili — dry run.`);
		} catch (err) {
			setMessage(err instanceof Error ? err.message : "Creazione bozza fallita.");
		} finally {
			setCreating(false);
		}
	}

	if (error) {return <ErrorNote>{error}</ErrorNote>;}
	if (!data) {return <Loading />;}

	const { segment } = data;

	return (
		<div className="space-y-4">
			<SectionTitle hint={`${segment.segmentName} · finestra ${segment.windowFrom} → ${segment.windowTo}`}>
				Segmento dinamico
			</SectionTitle>

			<div className="grid grid-cols-2 gap-3 md:grid-cols-4">
				<Card>
					<p className="text-[11px] uppercase" style={{ color: "var(--color-text-muted)" }}>Eleggibili</p>
					<p className="text-2xl font-semibold tabular-nums" style={{ color: "var(--color-text)" }}>{segment.counts.eligible}</p>
				</Card>
				<Card>
					<p className="text-[11px] uppercase" style={{ color: "var(--color-text-muted)" }}>Esclusi per consenso</p>
					<p className="text-2xl font-semibold tabular-nums" style={{ color: "var(--color-text)" }}>{segment.counts.excludedConsent}</p>
				</Card>
				<Card>
					<p className="text-[11px] uppercase" style={{ color: "var(--color-text-muted)" }}>Esclusi per identità</p>
					<p className="text-2xl font-semibold tabular-nums" style={{ color: "var(--color-text)" }}>{segment.counts.excludedIdentity}</p>
				</Card>
				<Card>
					<p className="text-[11px] uppercase" style={{ color: "var(--color-text-muted)" }}>Esclusi per dati/condizioni</p>
					<p className="text-2xl font-semibold tabular-nums" style={{ color: "var(--color-text)" }}>{segment.counts.excludedMissingData}</p>
				</Card>
			</div>

			<Card>
				<SectionTitle hint="Ogni inclusione ed esclusione ha una motivazione verificabile">Audience</SectionTitle>
				{[...segment.eligible, ...segment.excluded].length === 0 ? (
					<Empty>Nessun contatto valutato.</Empty>
				) : (
					<ul className="divide-y" style={{ borderColor: "var(--color-border)" }}>
						{segment.eligible.map((member) => (
							<li key={member.personId} className="py-2 text-sm">
								<div className="flex flex-wrap items-center justify-between gap-2">
									<span className="flex flex-wrap items-center gap-2">
										<a href={`/maxxi/people?id=${encodeURIComponent(member.personId)}`} className="font-medium underline-offset-2 hover:underline" style={{ color: "var(--color-text)" }}>
											{member.name}
										</a>
										<span className="text-xs" style={{ color: "var(--color-text-muted)" }}>{member.email}</span>
									</span>
									<Badge tone="ok">{REASON_LABEL[member.segmentReason]}</Badge>
								</div>
								<p className="mt-1 text-[11px]" style={{ color: "var(--color-text-muted)" }}>{member.reasons.join(" ")}</p>
							</li>
						))}
						{segment.excluded.map((member) => (
							<li key={member.personId} className="py-2 text-sm opacity-80">
								<div className="flex flex-wrap items-center justify-between gap-2">
									<span className="flex flex-wrap items-center gap-2">
										<a href={`/maxxi/people?id=${encodeURIComponent(member.personId)}`} className="font-medium hover:underline" style={{ color: "var(--color-text)" }}>
											{member.name}
										</a>
										<span className="text-xs" style={{ color: "var(--color-text-muted)" }}>{member.email}</span>
									</span>
									<Badge tone={member.segmentReason === "excluded_consent" ? "bad" : "warn"}>
										{REASON_LABEL[member.segmentReason] ?? member.segmentReason}
									</Badge>
								</div>
								<p className="mt-1 text-[11px]" style={{ color: "var(--color-text-muted)" }}>{member.reasons.join(" ")}</p>
							</li>
						))}
					</ul>
				)}
			</Card>

			<Card>
				<SectionTitle hint="Il testo cita solo il catalogo pubblico reale; nessun invio">Proposta di comunicazione</SectionTitle>
				<ul className="mb-3 space-y-1 text-xs" style={{ color: "var(--color-text-muted)" }}>
					{data.catalog.map((item) => (
						<li key={item.id}>
							{item.title} · {item.startDate} → {item.endDate}{" "}
							{item.isPublicReal ? "(mostra pubblica reale)" : "(catalogo demo)"}
						</li>
					))}
				</ul>
				<button
					type="button"
					onClick={createDraft}
					disabled={creating}
					className="rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-60"
					style={{ background: "var(--color-accent)", color: "#fff" }}
				>
					{creating ? "Creazione…" : "Crea bozza (dry run)"}
				</button>
				{message && <p className="mt-2 text-xs" style={{ color: "var(--color-text-muted)" }}>{message}</p>}
				<DemoNote>
					La bozza resta nel workspace demo. Nessuna email, SMS o telefonata viene inviata: in modalità demo i
					provider di invio sono bloccati lato server.
				</DemoNote>
			</Card>
		</div>
	);
}
