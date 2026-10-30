"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Card, DemoNote, ErrorNote, Loading, PageHeader, SectionTitle } from "../ui";
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
	const [loading, setLoading] = useState(true);
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
		} finally {
			setLoading(false);
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

	if (loading) {return <Loading label="Caricamento utenti…" />;}

	return (
		<div className="space-y-6">
			<PageHeader
				eyebrow="Strumenti / Accessi"
				title="Utenti e ruoli"
				subtitle="Identità e password vivono in Keycloak. La console invia le credenziali una sola volta e non le rilegge; i ruoli determinano i permessi lato server."
				actions={<Badge tone="neutral">Solo amministratore</Badge>}
			/>

			{error && <ErrorNote>{error}</ErrorNote>}
			{notice && (
				<p className="text-[12.5px]" role="status" style={{ color: "var(--maxxi-muted)" }}>
					{notice}
				</p>
			)}

			<Card>
				<SectionTitle hint="La password non viene memorizzata nella console">
					{editingId ? `Modifica ${username}` : "Nuovo utente"}
				</SectionTitle>
				<form onSubmit={submit} className="grid grid-cols-1 gap-4 md:grid-cols-2">
					<label className="flex flex-col gap-1.5">
						<span className="maxxi-eyebrow">Username</span>
						<input
							type="text"
							value={username}
							onChange={(e) => setUsername(e.target.value)}
							readOnly={editingId !== null}
							className="maxxi-input read-only:opacity-60"
							required
							pattern="[a-z0-9._-]{3,32}"
							title="3-32 caratteri: a-z, 0-9, . _ -"
						/>
					</label>
					<label className="flex flex-col gap-1.5">
						<span className="maxxi-eyebrow">Email</span>
						<input
							type="email"
							value={email}
							onChange={(e) => setEmail(e.target.value)}
							className="maxxi-input"
						/>
					</label>
					<label className="flex flex-col gap-1.5 md:col-span-2">
						<span className="maxxi-eyebrow">
							{editingId ? "Nuova password (lascia vuoto per non cambiarla)" : "Password iniziale (min. 8 caratteri)"}
						</span>
						<input
							type="password"
							value={password}
							onChange={(e) => setPassword(e.target.value)}
							className="maxxi-input"
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
									aria-pressed={checked}
									className="min-h-[44px] border px-3 text-[11.5px] font-semibold"
									style={{
										borderColor: checked ? "var(--maxxi-ink)" : "var(--maxxi-line-strong)",
										background: checked ? "var(--maxxi-ink)" : "var(--maxxi-paper)",
										color: checked ? "#ffffff" : "var(--maxxi-ink)",
									}}
								>
									{labelForRole(role)}
								</button>
							);
						})}
						<label className="flex min-h-[44px] items-center gap-2 text-[12px]">
							<input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
							attivo
						</label>
						{editingId && (
							<button type="button" onClick={resetForm} className="maxxi-secondary-action">
								Annulla
							</button>
						)}
						<button
							type="submit"
							disabled={busy || roles.length === 0}
							className="maxxi-primary-action ml-auto"
						>
							{busy ? "Salvataggio…" : editingId ? "Aggiorna" : "Crea utente"}
						</button>
					</div>
				</form>
			</Card>

			<Card className="p-0">
				<div className="p-4 pb-0 sm:p-5 sm:pb-0">
					<SectionTitle hint={`${operators.length} utenti nel realm crm-a`}>Utenti Keycloak</SectionTitle>
				</div>
				{operators.length === 0 ? (
					<p className="py-10 text-center text-sm" style={{ color: "var(--maxxi-muted)" }}>
						Nessun utente.
					</p>
				) : (
					<div className="maxxi-table-scroll">
						<table className="maxxi-table">
							<caption className="sr-only">Utenti del realm Keycloak con i ruoli CRM-A</caption>
							<thead>
								<tr>
									<th scope="col">Utente</th>
									<th scope="col">Ruoli</th>
									<th scope="col">Stato</th>
									<th scope="col">Azioni</th>
								</tr>
							</thead>
							<tbody>
								{operators.map((operator) => (
									<tr key={operator.id}>
										<th scope="row">
											<span className="font-medium">{operator.username}</span>
											{operator.email && (
												<span className="mt-0.5 block text-[11.5px] font-normal" style={{ color: "var(--maxxi-muted)" }}>
													{operator.email}
												</span>
											)}
										</th>
										<td>
											{operator.roles.length === 0 ? (
												<Badge tone="bad">Nessun ruolo</Badge>
											) : (
												<span className="flex flex-wrap gap-2">
													{operator.roles.map((role) => (
														<Badge key={role} tone="neutral">{labelForRole(role)}</Badge>
													))}
												</span>
											)}
										</td>
										<td>
											<Badge tone={operator.enabled ? "ok" : "bad"}>
												{operator.enabled ? "Attivo" : "Disattivo"}
											</Badge>
										</td>
										<td>
											<div className="flex flex-wrap gap-2">
												<button
													type="button"
													onClick={() => startEdit(operator)}
													className="maxxi-secondary-action"
												>
													Modifica
												</button>
												<button
													type="button"
													onClick={() => void remove(operator)}
													className="maxxi-secondary-action"
													style={{ color: "var(--maxxi-negative)", borderColor: "var(--maxxi-negative)" }}
												>
													Elimina
												</button>
											</div>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
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
