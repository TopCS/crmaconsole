"use client";

import { useState } from "react";
import { Badge, Card, DemoNote, ErrorNote, SectionTitle } from "../ui";

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

const EXAMPLES = [
	"Quali visitatori interessati all'architettura hanno una card myMAXXI in scadenza entro 45 giorni e consenso email?",
	"Chi è Maria Rossi? Da quali fonti arriva?",
	"Quanto hanno donato i sostenitori?",
	"Quali fonti abbiamo e quanto sono affidabili?",
];

export default function AgentPage() {
	const [question, setQuestion] = useState(EXAMPLES[0]);
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
		<div className="space-y-4">
			<SectionTitle hint="Risposte deterministiche dai dati demo: nessun modello cloud, nessuna invenzione">
				Assistente
			</SectionTitle>

			<Card>
				<label htmlFor="q" className="text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>
					Domanda
				</label>
				<textarea
					id="q"
					value={question}
					onChange={(event) => setQuestion(event.target.value)}
					rows={3}
					className="mt-1 w-full rounded-lg border p-2 text-sm"
					style={{ borderColor: "var(--color-border)", background: "var(--color-surface)", color: "var(--color-text)" }}
				/>
				<div className="mt-2 flex flex-wrap items-center gap-2">
					<button
						type="button"
						onClick={ask}
						disabled={busy || question.trim().length === 0}
						className="rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-60"
						style={{ background: "var(--color-accent)", color: "#fff" }}
					>
						{busy ? "Elaborazione…" : "Chiedi"}
					</button>
					{EXAMPLES.slice(1).map((example) => (
						<button
							key={example}
							type="button"
							onClick={() => setQuestion(example)}
							className="rounded-lg border px-2 py-1 text-[11px]"
							style={{ borderColor: "var(--color-border)", color: "var(--color-text-muted)" }}
						>
							{example.slice(0, 42)}…
						</button>
					))}
				</div>
			</Card>

			{error && <ErrorNote>{error}</ErrorNote>}

			{answer && (
				<Card>
					<div className="flex flex-wrap items-center gap-2">
						<Badge tone={answer.grounded ? "ok" : "warn"}>
							{answer.grounded ? "basata sui dati" : "nessuna evidenza"}
						</Badge>
						<Badge tone="neutral">{answer.intent}</Badge>
						{answer.window && (
							<span className="text-[11px]" style={{ color: "var(--color-text-muted)" }}>
								finestra {answer.window.from} → {answer.window.to}
							</span>
						)}
					</div>
					<p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--color-text)" }}>{answer.answer}</p>

					{answer.counts && (
						<div className="mt-3 flex flex-wrap gap-2">
							{Object.entries(answer.counts).map(([key, value]) => (
								<span key={key} className="rounded-lg border px-2 py-1 text-[11px]" style={{ borderColor: "var(--color-border)", color: "var(--color-text-muted)" }}>
									{key}: <strong style={{ color: "var(--color-text)" }}>{value}</strong>
								</span>
							))}
						</div>
					)}

					{answer.evidence.length > 0 && (
						<div className="mt-3">
							<p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--color-text-muted)" }}>
								Evidenze
							</p>
							<ul className="mt-1 space-y-0.5 text-[11px]" style={{ color: "var(--color-text-muted)" }}>
								{answer.evidence.slice(0, 20).map((item) => (
									<li key={`${item.kind}:${item.id}`}>
										{item.kind}: {item.id}{item.detail ? ` — ${item.detail}` : ""}
									</li>
								))}
								{answer.evidence.length > 20 && <li>… e altri {answer.evidence.length - 20}</li>}
							</ul>
						</div>
					)}

					{answer.citations.length > 0 && (
						<p className="mt-2 text-[11px]" style={{ color: "var(--color-text-muted)" }}>
							Fonti consultate: {answer.citations.join(", ")}
						</p>
					)}
				</Card>
			)}

			<DemoNote>
				L&apos;assistente lavora sul dataset dimostrativo con l&apos;orologio fisso della demo. Se una domanda esce
				dal perimetro dei dati caricati risponde &quot;non ho evidenze sufficienti&quot; invece di inventare.
			</DemoNote>
		</div>
	);
}
