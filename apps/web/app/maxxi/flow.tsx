"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const STEPS = [
	{ label: "Profilo", href: "/maxxi/people?id=P-MARIA", match: "/maxxi/people" },
	{ label: "Grafo", href: "/maxxi/graph?focus=P-MARIA&depth=2", match: "/maxxi/graph" },
	{ label: "Segmento", href: "/maxxi/segments", match: "/maxxi/segments" },
	{ label: "Bozza", href: "/maxxi/campaigns", match: "/maxxi/campaigns" },
];

/** Guided demo path; links carry the Maria context into the graph. */
export function MaxxiFlow() {
	const pathname = usePathname();
	return (
		<nav aria-label="Percorso demo" className="mb-6">
			<ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px]">
				<li className="maxxi-eyebrow mr-1">Percorso demo</li>
				{STEPS.map((step, index) => {
					const active = pathname === step.match || pathname.startsWith(`${step.match}/`);
					return (
						<li key={step.href} className="flex items-center gap-2">
							<Link
								href={step.href}
								aria-current={active ? "step" : undefined}
								className="inline-flex min-h-[32px] items-center gap-1.5 border px-2 py-1 font-semibold"
								style={{
									borderColor: active ? "var(--maxxi-ink)" : "var(--maxxi-line-strong)",
									background: active ? "var(--maxxi-ink)" : "var(--maxxi-paper)",
									color: active ? "#ffffff" : "var(--maxxi-ink)",
								}}
							>
								<span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
								{step.label}
							</Link>
							{index < STEPS.length - 1 && (
								<span aria-hidden="true" style={{ color: "var(--maxxi-muted)" }}>→</span>
							)}
						</li>
					);
				})}
			</ol>
		</nav>
	);
}
