import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage({
	searchParams,
}: {
	searchParams: Promise<{ next?: string }>;
}) {
	const params = await searchParams;
	// Only allow same-origin relative redirects.
	const raw = params.next ?? "/workspace";
	const next = raw.startsWith("/") && !raw.startsWith("//") ? raw : "/workspace";

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
			<LoginForm next={next} />
			<p className="max-w-sm text-center text-xs" style={{ color: "var(--color-text-muted)" }}>
				Ambiente protetto: le credenziali sono impostate dall&apos;operatore tramite variabili
				d&apos;ambiente.
			</p>
		</main>
	);
}
