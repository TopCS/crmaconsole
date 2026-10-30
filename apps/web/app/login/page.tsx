import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

const ERROR_MESSAGES: Record<string, string> = {
  not_configured: "Keycloak non è configurato. La console resta chiusa (fail-closed).",
  access_denied: "Accesso annullato o sessione scaduta. Riprova.",
  idp_error: "Keycloak ha rifiutato l'accesso. Riprova o contatta l'amministratore.",
  state_mismatch: "Sessione di accesso non valida (state). Riprova.",
  state_missing: "Sessione di accesso scaduta. Riprova.",
  state_invalid: "Sessione di accesso non valida. Riprova.",
  state_expired: "Hai impiegato troppo tempo per accedere. Riprova.",
  token_exchange_failed: "Scambio del token non riuscito. Riprova.",
  jwks_unavailable: "Chiavi di firma di Keycloak non raggiungibili. Riprova.",
  id_token_invalid: "Token di identità non valido. Riprova.",
  no_role: "Il tuo account non ha un ruolo CRM-A assegnato. Chiedi a un amministratore.",
  session_unavailable: "Sessione non disponibile: manca CRM_A_SESSION_SECRET.",
};

export default async function LoginPage({
	searchParams,
}: {
	searchParams: Promise<{ next?: string; error?: string; detail?: string }>;
}) {
	const params = await searchParams;
	// Only allow same-origin relative redirects.
	const raw = params.next ?? "/maxxi";
	const next = raw.startsWith("/") && !raw.startsWith("//") && !raw.startsWith("/\\") ? raw : "/maxxi";

	const error = params.error;
	if (!error) {
		// Identity is delegated to Keycloak: no password form lives in CRM-A.
		redirect(`/api/auth/login?next=${encodeURIComponent(next)}`);
	}

	const message = ERROR_MESSAGES[error] ?? "Accesso non riuscito. Riprova.";

	return (
		<main className="flex min-h-screen flex-col items-center justify-center gap-6 px-6">
			<div className="text-center">
				<h1 className="text-2xl font-semibold" style={{ color: "var(--color-text)" }}>
					MAXXI Customer Intelligence
				</h1>
				<p className="mt-1 text-sm" style={{ color: "var(--color-text-muted)" }}>
					Demo non ufficiale — dati sintetici
				</p>
			</div>

			<div
				role="alert"
				className="w-full max-w-sm rounded-xl border px-4 py-3 text-sm"
				style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
			>
				<p style={{ color: "var(--color-text)" }}>{message}</p>
				{params.detail && (
					<p className="mt-1 text-xs" style={{ color: "var(--color-text-muted)" }}>
						Account: {params.detail}
					</p>
				)}
			</div>

			<a
				href={`/api/auth/login?next=${encodeURIComponent(next)}`}
				className="rounded-lg px-4 py-2 text-sm font-semibold"
				style={{ background: "var(--color-accent)", color: "#fff" }}
			>
				Accedi con Keycloak
			</a>

			<p className="max-w-sm text-center text-xs" style={{ color: "var(--color-text-muted)" }}>
				L&apos;accesso è gestito da Keycloak (SSO). Le credenziali non transitano né vengono
				memorizzate nella console.
			</p>
		</main>
	);
}
