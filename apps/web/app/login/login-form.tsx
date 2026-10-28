"use client";

import { useState } from "react";

export function LoginForm({ next }: { next: string }) {
	const [username, setUsername] = useState("");
	const [password, setPassword] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	async function submit(event: React.FormEvent) {
		event.preventDefault();
		setBusy(true);
		setError(null);
		try {
			const res = await fetch("/api/auth/login", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ username, password }),
			});
			if (!res.ok) {
				const body = (await res.json().catch(() => ({}))) as { error?: string };
				setError(body.error ?? "Accesso non riuscito.");
				return;
			}
			window.location.assign(next);
		} catch {
			setError("Errore di rete. Riprova.");
		} finally {
			setBusy(false);
		}
	}

	return (
		<form onSubmit={submit} className="flex w-full max-w-sm flex-col gap-3">
			<label htmlFor="username" className="text-sm font-medium" style={{ color: "var(--color-text)" }}>
				Operatore
			</label>
			<input
				id="username"
				type="text"
				autoComplete="username"
				value={username}
				onChange={(event) => setUsername(event.target.value)}
				className="rounded-lg border px-3 py-2 text-sm"
				style={{
					borderColor: "var(--color-border)",
					background: "var(--color-surface)",
					color: "var(--color-text)",
				}}
				required
			/>
			<label htmlFor="password" className="text-sm font-medium" style={{ color: "var(--color-text)" }}>
				Password
			</label>
			<input
				id="password"
				type="password"
				autoComplete="current-password"
				value={password}
				onChange={(event) => setPassword(event.target.value)}
				className="rounded-lg border px-3 py-2 text-sm"
				style={{
					borderColor: "var(--color-border)",
					background: "var(--color-surface)",
					color: "var(--color-text)",
				}}
				required
			/>
			{error && (
				<p role="alert" className="text-sm" style={{ color: "var(--color-error, #ef4444)" }}>
					{error}
				</p>
			)}
			<button
				type="submit"
				disabled={busy}
				className="rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-60"
				style={{ background: "var(--color-accent)", color: "#fff" }}
			>
				{busy ? "Accesso…" : "Entra"}
			</button>
		</form>
	);
}
