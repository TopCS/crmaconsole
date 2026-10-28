"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Badge, Card, DemoNote, ErrorNote, Loading, PageHeader, SectionTitle } from "../ui";

type Answer = {
	intent: string;
	answer: string;
	grounded: boolean;
	window?: { from: string; to: string };
	counts?: Record<string, number>;
	evidence: Array<{ kind: string; id: string; detail?: string }>;
	citations: string[];
	fallback: boolean;
};

const COUNT_LABELS: Record<string, string> = {
	eligible: "Eleggibili",
	excludedConsent: "Esclusi · consenso",
	excludedIdentity: "Esclusi · identità",
	excludedMissingData: "Esclusi · dati o condizioni",
};

const EXAMPLES = [
	"Quali visitatori interessati all'architettura hanno una card myMAXXI in scadenza entro 45 giorni e consenso email?",
	"Chi è Maria Rossi? Da quali fonti arriva?",
	"Quali fonti abbiamo e quanto sono affidabili?",
	"Quanto hanno donato i sostenitori?",
];

export default function AgentPage() {
	return (
		<Suspense fallback={<Loading label="Caricamento assistente…" />}>
			<AgentInner />
		</Suspense>
	);
}

function AgentInner() {
	const params = useSearchParams();
	const [question, setQuestion] = useState(params.get("q") ?? EXAMPLES[0]);
	const [answer, setAnswer] = useState<Answer | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	async function ask() {
		setBusy(true);
		setError(null);
		setAnswer(null);
		try {
			const res = await fetch("/api/maxxi/ask", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ question }),
			});
			const body = (await res.json()) as { answer?: Answer; error?: string };
			if (!res.ok || !body.answer) {throw new Error(body.error ?? `HTTP ${res.status}`);}
			setAnswer(body.answer);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Richiesta fallita.");
		} finally {
			setBusy(false);
		}
	}

	return (
		<div className="space-y-6">
			<PageHeader
				eyebrow="Strumenti / Assistente"
				title="Assistente MAXXI"
				subtitle="Risposte deterministiche dai dati demo, con ID e finestra temporale. Nessun modello cloud: se il dato non c'è, l'assistente lo dichiara."
				actions={<Badge tone="neutral">Solo dati dimostrativi</Badge>}
			/>

			<div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
				<Card className="lg:col-span-2">
					<SectionTitle hint="La domanda viene valutata sul dataset caricato">Fai una domanda</SectionTitle>
					<label htmlFor="maxxi-question" className="maxxi-eyebrow">
						Domanda
					</label>
					<textarea
						id="maxxi-question"
						value={question}
						onChange={(event) => setQuestion(event.target.value)}
						rows={4}
						className="maxxi-input mt-2 resize-y"
					/>
					<div className="mt-3 flex flex-wrap gap-2">
						<button
							type="button"
							onClick={ask}
							disabled={busy || question.trim().length === 0}
							className="maxxi-primary-action"
						>
							{busy ? "Elaborazione…" : "Chiedi"}
						</button>
					</div>

					<div className="mt-6 border-t pt-4" style={{ borderColor: "var(--maxxi-line)" }}>
						<p className="maxxi-eyebrow">Domande suggerite</p>
						<ul className="mt-2 space-y-1.5">
							{EXAMPLES.map((example) => (
								<li key={example}>
									<button
										type="button"
										onClick={() => setQuestion(example)}
										className="w-full border px-2.5 py-2 text-left text-[11.5px] leading-snug hover:bg-[var(--maxxi-selected)]"
										style={{ borderColor: "var(--maxxi-line)" }}
									>
										{example}
									</button>
								</li>
							))}
						</ul>
					</div>

					<DemoNote>
						L&apos;assistente usa l&apos;orologio fisso della demo. Non inventa esposizioni, presenze, consensi
						o importi: fuori dal perimetro risponde &quot;non ho evidenze sufficienti&quot;.
					</DemoNote>
				</Card>

				<div className="lg:col-span-3">
					{error && <ErrorNote>{error}</ErrorNote>}

					{!answer && !error && (
						<Card>
							<SectionTitle>Risposta</SectionTitle>
							<p className="py-8 text-center text-[13px]" style={{ color: "var(--maxxi-muted)" }}>
								Formula una domanda per vedere la risposta con le evidenze collegate.
							</p>
						</Card>
					)}

					{answer && (
						<Card>
							<div className="flex flex-wrap items-center gap-2">
								<Badge tone={answer.grounded ? "ok" : "warn"}>
									{answer.grounded ? "Basata sui dati" : "Nessuna evidenza"}
								</Badge>
								<Badge tone="neutral">{answer.intent}</Badge>
								{answer.window && (
									<span className="text-[11px]" style={{ color: "var(--maxxi-muted)" }}>
										finestra {answer.window.from} → {answer.window.to}
									</span>
								)}
							</div>

							<div aria-live="polite" className="mt-4">
								<p className="text-[14px] leading-relaxed">{answer.answer}</p>
							</div>

							{answer.counts && (
								<dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
									{Object.entries(answer.counts).map(([key, value]) => (
										<div key={key} className="border p-2.5" style={{ borderColor: "var(--maxxi-line)" }}>
											<dt className="maxxi-eyebrow">{COUNT_LABELS[key] ?? key}</dt>
											<dd className="maxxi-kpi-value mt-1 text-[22px]">{value}</dd>
										</div>
									))}
								</dl>
							)}

							{answer.evidence.length > 0 && (
								<div className="mt-5 border-t pt-4" style={{ borderColor: "var(--maxxi-line)" }}>
									<p className="maxxi-eyebrow">Evidenze</p>
									<ul className="mt-2 space-y-1 text-[11.5px]" style={{ color: "var(--maxxi-muted)" }}>
										{answer.evidence.slice(0, 20).map((item) => (
											<li key={`${item.kind}:${item.id}`}>
												<span className="font-semibold" style={{ color: "var(--maxxi-ink)" }}>{item.kind}</span>:{" "}
												{item.id}
												{item.detail ? ` — ${item.detail}` : ""}
											</li>
										))}
										{answer.evidence.length > 20 && <li>… e altri {answer.evidence.length - 20}</li>}
									</ul>
								</div>
							)}

							{answer.citations.length > 0 && (
								<p className="mt-3 text-[11px]" style={{ color: "var(--maxxi-muted)" }}>
									Fonti consultate: {answer.citations.join(", ")}
								</p>
							)}

							{answer.grounded && (
								<div className="mt-5 flex flex-wrap gap-2 border-t pt-4" style={{ borderColor: "var(--maxxi-line)" }}>
									<Link href="/maxxi/segments" className="maxxi-primary-action">
										Prepara bozza dal segmento
									</Link>
									{answer.evidence.some((item) => item.kind === "person" && item.id.startsWith("P-")) && (
										<Link
											href={`/maxxi/people?id=${encodeURIComponent(
												answer.evidence.find((item) => item.kind === "person" && item.id.startsWith("P-"))?.id ?? "",
											)}`}
											className="maxxi-secondary-action"
										>
											Apri profilo correlato
										</Link>
									)}
								</div>
							)}
						</Card>
					)}
				</div>
			</div>
		</div>
	);
}
