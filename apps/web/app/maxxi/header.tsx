"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { hasRole, useMe } from "./use-me";

const NAV = [
	{ href: "/maxxi", label: "Panoramica", require: null },
	{ href: "/maxxi/people", label: "Visitatori", require: null },
	{ href: "/maxxi/sources", label: "Fonti", require: null },
	{ href: "/maxxi/segments", label: "Segmenti", require: null },
	{ href: "/maxxi/campaigns", label: "Campagne", require: null },
	{ href: "/maxxi/agent", label: "Assistente", require: null },
	{ href: "/maxxi/operators", label: "Operatori", require: "admin" },
];

export function MaxxiHeader() {
	const { me } = useMe();
	const pathname = usePathname();
	const items = NAV.filter((item) => !item.require || hasRole(me, item.require));

	async function logout() {
		await fetch("/api/auth/logout", { method: "POST" });
		window.location.assign("/login");
	}

	return (
		<>
			<div className="flex items-center gap-3 text-[12px]" style={{ color: "var(--color-text-muted)" }}>
				{me && (
					<span className="hidden sm:inline">
						<span style={{ color: "var(--color-text)" }}>{me.username}</span>
						{me.roles.length > 0 && <> · {me.roles.join(", ")}</>}
					</span>
				)}
				<nav className="flex flex-wrap gap-1">
					{items.map((item) => (
						<Link
							key={item.href}
							href={item.href}
							className="rounded-lg px-2.5 py-1.5 text-[12px] font-medium hover:opacity-80"
							style={{
								color: pathname === item.href ? "var(--color-text)" : "var(--color-text-muted)",
								background: pathname === item.href ? "var(--color-surface-hover)" : "transparent",
							}}
						>
							{item.label}
						</Link>
					))}
				</nav>
				<button
					type="button"
					onClick={logout}
					className="rounded-lg border px-2 py-1 text-[11px]"
					style={{ borderColor: "var(--color-border)", color: "var(--color-text-muted)" }}
				>
					Esci
				</button>
			</div>
		</>
	);
}
