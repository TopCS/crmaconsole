"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Card, ErrorNote, Loading, SectionTitle } from "./ui";

type CheckStatus = "ok" | "warn" | "bad";
type DemoCheck = { id: string; label: string; status: CheckStatus; detail: string };
type DemoStatus = {
	generatedAt: string;
	clock: string;
	demoMode: boolean;
	canSeed: boolean;
	role: string;
	checks: DemoCheck[];
	counts: {
		people: number;
		sources: number;
		campaigns: number;
		drafts: number;
		approved: number;
		pendingReviews: number;
		reviewDecisions: number;
	};
};

const TONE: Record<CheckStatus, "ok" | "warn" | "bad"> = {
	ok: "ok",
	warn: "warn",
	bad: "bad",
};

const STATUS_LABEL: Record<CheckStatus, string> = {
	ok: "Pronto",
	warn: "Attenzione",
	bad: "Bloccante",
};

function formatWhen(value: string): string {
	return value ? `${value.slice(0, 10)} ${value.slice(11, 16)}` : "—";
}

/**
 * Presenter readiness panel: checks identity, data, demo kill-switch, AI
 * provider and the review queue, and exposes the destructive reset only to
 * admins, behind an explicit two-step confirmation.
 */
export function DemoStatusCard({ onSeeded }: { onSeeded?: () => void }) {
	const [status, setStatus] = useState<DemoStatus | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [confirming, setConfirming] = useState(false);
	const [seeding, setSeeding] = useState(false);
	const [notice, setNotice] = useState<string | null>(null);

	const load = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const res = await fetch("/api/maxxi/status", { cache: "no-store" });
			const body = (await res.json()) as DemoStatus & { error?: string };
			if (!res.ok) {throw new Error(body.error ?? `HTTP ${res.status}`);}
			setStatus(body);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Controllo demo fallito.");
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	async function reseed() {
		setSeeding(true);
		setNotice(null);
		setError(null);
		try {
			const res = await fetch("/api/maxxi/seed", { method: "POST" });
			const body = (await res.json()) as { error?: string; counts?: { people: number; sources?: number } };
			if (!res.ok) {throw new Error(body.error ?? `HTTP ${res.status}`);}
			setNotice(
				`Dati demo ripristinati: ${body.counts?.people ?? 0} persone e ${body.counts?.sources ?? "tutte le"} fonti. Campagne, versioni e decisioni sono state azzerate.`,
			);
			setConfirming(false);
			await load();
			onSeeded?.();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Ricarica demo fallita.");
		} finally {
			setSeeding(false);
		}
	}

	const blocking = status?.checks.some((check) => check.status === "bad") ?? false;

	return (
		<Card>
			<div className="flex flex-wrap items-start justify-between gap-3">
				<SectionTitle hint="Verifica accesso, dati, kill-switch e servizi prima di salire sul palco">
					Stato della demo
				</SectionTitle>
				<div className="flex flex-wrap items-center gap-2">
					{status && (
						<Badge tone={blocking ? "bad" : "ok"}>
							{blocking ? "Non pronta" : "Pronta"}
						</Badge>
					)}
					<button
						type="button"
						onClick={() => void load()}
						disabled={loading || seeding}
						className="maxxi-secondary-action"
					>
						{loading ? "Controllo…" : "Ricontrolla"}
					</button>
				</div>
			</div>

			{error && <ErrorNote>{error}</ErrorNote>}
			{!status && loading && <Loading label="Controllo dei servizi demo…" />}

			{status && (
				<>
					<ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
						{status.checks.map((check) => (
							<li
								key={check.id}
								className="border p-3"
								style={{ borderColor: "var(--maxxi-line)" }}
							>
								<div className="flex flex-wrap items-center justify-between gap-2">
									<span className="text-[12.5px] font-semibold">{check.label}</span>
									<Badge tone={TONE[check.status]}>{STATUS_LABEL[check.status]}</Badge>
								</div>
								<p className="mt-1 text-[11.5px] leading-relaxed" style={{ color: "var(--maxxi-muted)" }}>
									{check.detail}
								</p>
							</li>
						))}
					</ul>

					<p className="mt-3 text-[11px]" style={{ color: "var(--maxxi-muted)" }}>
						Ultimo controllo {formatWhen(status.generatedAt)} · orologio demo {status.clock.slice(0, 10)} · ruolo {status.role}
					</p>

					{notice && (
						<p role="status" className="mt-3 border-t pt-3 text-[12px]" style={{ borderColor: "var(--maxxi-line)" }}>
							{notice}
						</p>
					)}

					{status.canSeed ? (
						<div className="mt-4 border-t pt-4" style={{ borderColor: "var(--maxxi-line)" }}>
							{confirming ? (
								<div role="alertdialog" aria-labelledby="demo-reset-title" aria-describedby="demo-reset-desc">
									<p id="demo-reset-title" className="text-[13px] font-semibold">
										Ripristinare il dataset demo?
									</p>
									<p id="demo-reset-desc" className="mt-1 text-[12px] leading-relaxed" style={{ color: "var(--maxxi-muted)" }}>
										L’operazione elimina campagne, versioni, snapshot, audit e decisioni della demo, poi
										ricarica i dati iniziali. Non tocca il CRM principale né alcun dato reale.
									</p>
									<div className="mt-3 flex flex-wrap gap-2">
										<button
											type="button"
											onClick={() => void reseed()}
											disabled={seeding}
											className="maxxi-primary-action"
										>
											{seeding ? "Ripristino…" : "Sì, ripristina la demo"}
										</button>
										<button
											type="button"
											onClick={() => setConfirming(false)}
											disabled={seeding}
											className="maxxi-secondary-action"
										>
											Annulla
										</button>
									</div>
								</div>
							) : (
								<div className="flex flex-wrap items-center justify-between gap-3">
									<p className="max-w-2xl text-[11.5px]" style={{ color: "var(--maxxi-muted)" }}>
										La ricarica è riservata all’amministratore e chiede una conferma esplicita.
									</p>
									<button type="button" onClick={() => setConfirming(true)} className="maxxi-secondary-action">
										Ricarica dati demo
									</button>
								</div>
							)}
						</div>
					) : (
						<p className="mt-4 border-t pt-3 text-[11.5px]" style={{ borderColor: "var(--maxxi-line)", color: "var(--maxxi-muted)" }}>
							Solo un amministratore può ricaricare i dati demo.
						</p>
					)}
				</>
			)}
		</Card>
	);
}
