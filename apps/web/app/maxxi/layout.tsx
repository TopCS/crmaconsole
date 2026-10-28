import type { ReactNode } from "react";
import Link from "next/link";
import { DEMO_BANNER } from "./ui";

export const dynamic = "force-dynamic";

const NAV = [
	{ href: "/maxxi", label: "Panoramica" },
	{ href: "/maxxi/people", label: "Visitatori" },
	{ href: "/maxxi/sources", label: "Fonti" },
	{ href: "/maxxi/segments", label: "Segmenti" },
	{ href: "/maxxi/campaigns", label: "Campagne" },
	{ href: "/maxxi/agent", label: "Assistente" },
];

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
					<nav className="flex flex-wrap gap-1">
						{NAV.map((item) => (
							<Link
								key={item.href}
								href={item.href}
								className="rounded-lg px-2.5 py-1.5 text-[12px] font-medium hover:opacity-80"
								style={{ color: "var(--color-text-muted)" }}
							>
								{item.label}
							</Link>
						))}
					</nav>
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
