"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Card, DemoNote, ErrorNote, SectionTitle } from "../ui";
import { labelForRole, type OperatorRole } from "../../../lib/security/rbac";

type OperatorRow = {
	id: string;
	username: string;
	email: string;
	firstName: string;
	lastName: string;
	enabled: boolean;
	roles: OperatorRole[];
};

const ROLE_OPTIONS: OperatorRole[] = ["admin", "communication", "membership", "infopoint", "relations"];

export default function OperatorsPage() {
	const [operators, setOperators] = useState<OperatorRow[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	const [editingId, setEditingId] = useState<string | null>(null);
	const [username, setUsername] = useState("");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [roles, setRoles] = useState<OperatorRole[]>(["communication"]);
	const [enabled, setEnabled] = useState(true);

	const load = useCallback(async () => {
		setError(null);
		try {
			const res = await fetch("/api/maxxi/operators", { cache: "no-store" });
			const body = (await res.json()) as { operators?: OperatorRow[]; error?: string; hint?: string };
			if (!res.ok) {throw new Error(body.hint ? `${body.error} ${body.hint}` : (body.error ?? `HTTP ${res.status}`));}
			setOperators(body.operators ?? []);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Caricamento fallito.");
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	function resetForm() {
		setEditingId(null); setUsername(""); setEmail(""); setPassword("");
		setRoles(["communication"]); setEnabled(true);
	}

	function startEdit(row: OperatorRow) {
		setEditingId(row.id); setUsername(row.username); setEmail(row.email);
		setPassword(""); setRoles(row.roles.length > 0 ? row.roles : ["communication"]);
		setEnabled(row.enabled); setNotice(null);
	}

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
				method: editingId ? "PATCH" : "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					id: editingId ?? undefined,
					username,
					email: email || undefined,
					password: password || undefined,
					roles,
					enabled,
				}),
			});
			const body = (await res.json()) as { error?: string; username?: string };
			if (!res.ok) {throw new Error(body.error ?? `HTTP ${res.status}`);}
			setNotice(editingId ? `Utente ${username} aggiornato in Keycloak.` : `Utente ${body.username} creato in Keycloak.`);
			resetForm();
			await load();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Salvataggio fallito.");
		} finally {
			setBusy(false);
		}
	}

	async function remove(row: OperatorRow) {
		if (!confirm(`Eliminare l'utente "${row.username}" da Keycloak?`)) {return;}
		try {
			const res = await fetch(`/api/maxxi/operators?id=${encodeURIComponent(row.id)}`, {
				method: "DELETE",
			});
			const body = (await res.json()) as { error?: string };
			if (!res.ok) {throw new Error(body.error ?? `HTTP ${res.status}`);}
			if (editingId === row.id) {resetForm();}
			await load();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Eliminazione fallita.");
		}
	}

	return (
		<div className="space-y-4">
			<SectionTitle hint="Identità e ruoli sono gestiti da Keycloak (solo amministratore)">Accessi</SectionTitle>

			{error && <ErrorNote>{error}</ErrorNote>}
			{notice && <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>{notice}</p>}

			<Card>
				<SectionTitle hint="La console non memorizza password: le invia a Keycloak una sola volta">
					{editingId ? `Modifica ${username}` : "Nuovo utente"}
				</SectionTitle>
				<form onSubmit={submit} className="grid gap-3 md:grid-cols-2">
					<label className="flex flex-col gap-1 text-xs" style={{ color: "var(--color-text-muted)" }}>
						Username
						<input
							type="text"
							value={username}
							onChange={(e) => setUsername(e.target.value)}
							readOnly={editingId !== null}
							className="rounded-lg border px-2 py-1.5 text-sm read-only:opacity-60"
							style={{ borderColor: "var(--color-border)", background: "var(--color-surface)", color: "var(--color-text)" }}
							required
							pattern="[a-z0-9._-]{3,32}"
							title="3-32 caratteri: a-z, 0-9, . _ -"
						/>
					</label>
					<label className="flex flex-col gap-1 text-xs" style={{ color: "var(--color-text-muted)" }}>
						Email
						<input
							type="email"
							value={email}
							onChange={(e) => setEmail(e.target.value)}
							className="rounded-lg border px-2 py-1.5 text-sm"
							style={{ borderColor: "var(--color-border)", background: "var(--color-surface)", color: "var(--color-text)" }}
						/>
					</label>
					<label className="flex flex-col gap-1 text-xs md:col-span-2" style={{ color: "var(--color-text-muted)" }}>
						{editingId ? "Nuova password (lascia vuoto per non cambiarla)" : "Password iniziale (min. 8 caratteri)"}
						<input
							type="password"
							value={password}
							onChange={(e) => setPassword(e.target.value)}
							className="rounded-lg border px-2 py-1.5 text-sm"
							style={{ borderColor: "var(--color-border)", background: "var(--color-surface)", color: "var(--color-text)" }}
							minLength={8}
							required={editingId === null}
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
							<input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
							attivo
						</label>
						{editingId && (
							<button
								type="button"
								onClick={resetForm}
								className="rounded-lg border px-2.5 py-1 text-[11px]"
								style={{ borderColor: "var(--color-border)", color: "var(--color-text-muted)" }}
							>
								Annulla
							</button>
						)}
						<button
							type="submit"
							disabled={busy || roles.length === 0}
							className="ml-auto rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-60"
							style={{ background: "var(--color-accent)", color: "#fff" }}
						>
							{busy ? "Salvataggio…" : editingId ? "Aggiorna" : "Crea utente"}
						</button>
					</div>
				</form>
			</Card>

			<Card>
				<SectionTitle hint={`${operators.length} utenti nel realm`}>Utenti Keycloak</SectionTitle>
				{operators.length === 0 ? (
					<p className="py-4 text-center text-sm" style={{ color: "var(--color-text-muted)" }}>
						Nessun utente.
					</p>
				) : (
					<ul className="divide-y" style={{ borderColor: "var(--color-border)" }}>
						{operators.map((operator) => (
							<li key={operator.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
								<span className="flex flex-wrap items-center gap-2">
									<span style={{ color: "var(--color-text)" }}>{operator.username}</span>
									{operator.roles.length === 0 && <Badge tone="bad">nessun ruolo</Badge>}
									{operator.roles.map((role) => (
										<Badge key={role} tone="neutral">{labelForRole(role)}</Badge>
									))}
								</span>
								<span className="flex items-center gap-2 text-xs" style={{ color: "var(--color-text-muted)" }}>
									<Badge tone={operator.enabled ? "ok" : "bad"}>{operator.enabled ? "attivo" : "disattivo"}</Badge>
									<button
										type="button"
										onClick={() => startEdit(operator)}
										className="rounded-lg border px-2 py-0.5 text-[11px]"
										style={{ borderColor: "var(--color-border)", color: "var(--color-text)" }}
									>
										Modifica
									</button>
									<button
										type="button"
										onClick={() => void remove(operator)}
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
				Keycloak è l&apos;unica fonte di identità: utenti, password e ruoli vivono nel realm
				<code className="mx-1">crm-a</code>. La console applica i permessi lato server; le note
				infopoint sono visibili solo a Infopoint e Amministratore.
			</DemoNote>
		</div>
	);
}
