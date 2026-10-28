"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Card, DemoNote, ErrorNote, SectionTitle } from "../ui";
import { labelForRole, type OperatorRole } from "../../../lib/security/rbac";

type OperatorRow = {
	username: string;
	roles: OperatorRole[];
	active: boolean;
	createdAt: string;
	updatedAt: string;
	createdBy: string;
};

const ROLE_OPTIONS: OperatorRole[] = ["admin", "communication", "membership", "infopoint", "relations"];

export default function OperatorsPage() {
	const [operators, setOperators] = useState<OperatorRow[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	const [username, setUsername] = useState("");
	const [password, setPassword] = useState("");
	const [roles, setRoles] = useState<OperatorRole[]>(["communication"]);
	const [active, setActive] = useState(true);

	const load = useCallback(async () => {
		setError(null);
		try {
			const res = await fetch("/api/maxxi/operators", { cache: "no-store" });
			const body = (await res.json()) as { operators?: OperatorRow[]; error?: string };
			if (!res.ok) {throw new Error(body.error ?? `HTTP ${res.status}`);}
			setOperators(body.operators ?? []);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Caricamento fallito.");
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	function toggleRole(role: OperatorRole) {
		setRoles((current) =>
			current.includes(role) ? current.filter((r) => r !== role) : [...current, role],
		);
	}

	async function submit(event: React.FormEvent) {
		event.preventDefault();
		setBusy(true);
		setNotice(null);
		try {
			const res = await fetch("/api/maxxi/operators", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ username, password: password || undefined, roles, active }),
			});
			const body = (await res.json()) as { error?: string; username?: string };
			if (!res.ok) {throw new Error(body.error ?? `HTTP ${res.status}`);}
			setNotice(`Account ${body.username} salvato.`);
			setUsername(""); setPassword(""); setRoles(["communication"]); setActive(true);
			await load();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Salvataggio fallito.");
		} finally {
			setBusy(false);
		}
	}

	async function remove(username_: string) {
		if (!confirm(`Eliminare l'account "${username_}"?`)) {return;}
		try {
			const res = await fetch(`/api/maxxi/operators?username=${encodeURIComponent(username_)}`, {
				method: "DELETE",
			});
			const body = (await res.json()) as { error?: string };
			if (!res.ok) {throw new Error(body.error ?? `HTTP ${res.status}`);}
			await load();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Eliminazione fallita.");
		}
	}

	return (
		<div className="space-y-4">
			<SectionTitle hint="Account individuali e ruoli (solo amministratore)">Operatori</SectionTitle>

			{error && <ErrorNote>{error}</ErrorNote>}
			{notice && <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>{notice}</p>}

			<Card>
				<SectionTitle hint="La password è hashed con scrypt; nessuna credenziale è salvata in chiaro">
					Nuovo account / modifica
				</SectionTitle>
				<form onSubmit={submit} className="grid gap-3 md:grid-cols-2">
					<label className="flex flex-col gap-1 text-xs" style={{ color: "var(--color-text-muted)" }}>
						Username
						<input
							type="text"
							value={username}
							onChange={(e) => setUsername(e.target.value)}
							className="rounded-lg border px-2 py-1.5 text-sm"
							style={{ borderColor: "var(--color-border)", background: "var(--color-surface)", color: "var(--color-text)" }}
							required
							pattern="[a-z0-9._-]{3,32}"
							title="3-32 caratteri: a-z, 0-9, . _ -"
						/>
					</label>
					<label className="flex flex-col gap-1 text-xs" style={{ color: "var(--color-text-muted)" }}>
						Password (lascia vuoto per non cambiarla)
						<input
							type="password"
							value={password}
							onChange={(e) => setPassword(e.target.value)}
							className="rounded-lg border px-2 py-1.5 text-sm"
							style={{ borderColor: "var(--color-border)", background: "var(--color-surface)", color: "var(--color-text)" }}
							minLength={8}
						/>
					</label>
					<div className="flex flex-wrap items-center gap-2 md:col-span-2">
						{ROLE_OPTIONS.map((role) => {
							const checked = roles.includes(role);
							return (
								<button
									key={role}
									type="button"
									onClick={() => toggleRole(role)}
									className="rounded-lg border px-2.5 py-1 text-[11px] font-medium"
									style={{
										borderColor: checked ? "var(--color-accent)" : "var(--color-border)",
										color: checked ? "var(--color-accent)" : "var(--color-text-muted)",
										background: checked ? "color-mix(in srgb, var(--color-accent) 14%, transparent)" : "transparent",
									}}
								>
									{labelForRole(role)}
								</button>
							);
						})}
						<label className="flex items-center gap-1.5 text-xs" style={{ color: "var(--color-text-muted)" }}>
							<input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
							attivo
						</label>
						<button
							type="submit"
							disabled={busy || roles.length === 0}
							className="ml-auto rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-60"
							style={{ background: "var(--color-accent)", color: "#fff" }}
						>
							{busy ? "Salvataggio…" : "Salva"}
						</button>
					</div>
				</form>
			</Card>

			<Card>
				<SectionTitle hint={`${operators.length} account`}>Elenco</SectionTitle>
				{operators.length === 0 ? (
					<p className="py-4 text-center text-sm" style={{ color: "var(--color-text-muted)" }}>
						Nessun account.
					</p>
				) : (
					<ul className="divide-y" style={{ borderColor: "var(--color-border)" }}>
						{operators.map((operator) => (
							<li key={operator.username} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
								<span className="flex flex-wrap items-center gap-2">
									<span style={{ color: "var(--color-text)" }}>{operator.username}</span>
									{operator.roles.map((role) => (
										<Badge key={role} tone="neutral">{labelForRole(role)}</Badge>
									))}
								</span>
								<span className="flex items-center gap-2 text-xs" style={{ color: "var(--color-text-muted)" }}>
									<Badge tone={operator.active ? "ok" : "bad"}>{operator.active ? "attivo" : "disattivo"}</Badge>
									<span>creato da {operator.createdBy}</span>
									<button
										type="button"
										onClick={() => remove(operator.username)}
										className="rounded-lg border px-2 py-0.5 text-[11px]"
										style={{ borderColor: "var(--color-border)", color: "var(--color-error, #ef4444)" }}
									>
										Elimina
									</button>
								</span>
							</li>
						))}
					</ul>
				)}
			</Card>

			<DemoNote>
				I ruoli limitano anche lato server: le note infopoint sono visibili solo a Infopoint e
				Amministratore; solo Comunicazione (o admin) può creare/approvare bozze; il seed è admin-only.
			</DemoNote>
		</div>
	);
}
