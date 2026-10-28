import type { ReactNode } from "react";
import { MaxxiHeader } from "./header";
import { DEMO_BANNER } from "./ui";

export const dynamic = "force-dynamic";

export default function MaxxiLayout({ children }: { children: ReactNode }) {
	return (
		<div className="min-h-screen" style={{ background: "var(--color-background)" }}>
			<header
				className="sticky top-0 z-20 border-b"
				style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
			>
				<div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-3">
					<div className="min-w-0">
						<p className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>
							MAXXI Customer Intelligence
						</p>
						<p className="text-[11px]" style={{ color: "var(--color-text-muted)" }}>
							Demo non ufficiale
						</p>
					</div>
					<MaxxiHeader />
				</div>
				<div
					className="px-5 py-1.5 text-center text-[11px] font-semibold uppercase tracking-[0.14em]"
					style={{ background: "#f59e0b1f", color: "#b45309" }}
				>
					{DEMO_BANNER}
				</div>
			</header>
			<main className="mx-auto max-w-6xl px-5 py-6">{children}</main>
		</div>
	);
}
