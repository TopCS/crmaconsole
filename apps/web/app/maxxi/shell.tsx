"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { hasRole, useMe } from "./use-me";
import { labelForRole, type OperatorRole } from "../../lib/security/rbac";
import { MaxxiFlow } from "./flow";

type NavItem = { href: string; label: string; require?: OperatorRole; requireAny?: OperatorRole[] };
type NavGroup = { label: string; items: NavItem[] };

const NAV_GROUPS: NavGroup[] = [
	{
		label: "Intelligence",
		items: [{ href: "/maxxi", label: "Panoramica" }],
	},
	{
		label: "Pubblico",
		items: [
			{ href: "/maxxi/people", label: "Visitatori" },
			{ href: "/maxxi/sources", label: "Fonti dati" },
			{ href: "/maxxi/segments", label: "Segmenti" },
			{ href: "/maxxi/graph", label: "Grafo relazioni", requireAny: ["admin", "communication", "membership", "infopoint"] },
		],
	},
	{
		label: "Attivazione",
		items: [{ href: "/maxxi/campaigns", label: "Campagne" }],
	},
	{
		label: "Strumenti",
		items: [
			{ href: "/maxxi/agent", label: "Assistente" },
			{ href: "/maxxi/operators", label: "Accessi", require: "admin" },
		],
	},
];

function isActive(pathname: string, href: string): boolean {
	if (href === "/maxxi") {return pathname === "/maxxi";}
	return pathname === href || pathname.startsWith(`${href}/`);
}

function currentLabel(pathname: string): string {
	for (const group of NAV_GROUPS) {
		for (const item of group.items) {
			if (isActive(pathname, item.href)) {return item.label;}
		}
	}
	return "Panoramica";
}

export function MaxxiShell({ children }: { children: ReactNode }) {
	const pathname = usePathname();
	const router = useRouter();
	const { me } = useMe();
	const [open, setOpen] = useState(false);
	const [globalQuery, setGlobalQuery] = useState("");
	const menuButton = useRef<HTMLButtonElement>(null);
	const sidebar = useRef<HTMLElement>(null);

	useEffect(() => {
		setOpen(false);
	}, [pathname]);

	useEffect(() => {
		if (!open) {return;}
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				setOpen(false);
				menuButton.current?.focus();
			}
		};
		document.addEventListener("keydown", onKey);
		const previous = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		sidebar.current?.querySelector<HTMLElement>("a, button")?.focus();
		return () => {
			document.removeEventListener("keydown", onKey);
			document.body.style.overflow = previous;
		};
	}, [open]);

	async function logout() {
		const res = await fetch("/api/auth/logout", { method: "POST" });
		const body = (await res.json().catch(() => ({}))) as { logoutUrl?: string };
		window.location.assign(body.logoutUrl ?? "/login");
	}

	const groups = NAV_GROUPS.map((group) => ({
		...group,
		items: group.items.filter((item) => {
			if (item.require && !hasRole(me, item.require)) {return false;}
			if (item.requireAny && !item.requireAny.some((role) => hasRole(me, role))) {return false;}
			return true;
		}),
	})).filter((group) => group.items.length > 0);

	return (
		<div data-workspace-theme="maxxi" className="maxxi-shell">
			<a
				href="#maxxi-main"
				className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:bg-white focus:px-3 focus:py-2 focus:text-sm"
			>
				Vai al contenuto
			</a>

			{open && (
				<div
					className="maxxi-scrim lg:hidden"
					aria-hidden="true"
					onClick={() => setOpen(false)}
				/>
			)}

			<div className="flex min-h-screen">
				<aside
					ref={sidebar}
					id="maxxi-sidebar"
					className="maxxi-sidebar lg:sticky lg:top-0 lg:h-screen"
					data-open={open ? "true" : "false"}
					aria-label="Navigazione MAXXI"
				>
					<div className="maxxi-wordmark">
						<p className="maxxi-wordmark-line">MAXXI</p>
						<p className="maxxi-wordmark-sub">Customer Intelligence</p>
					</div>

					<nav className="flex-1 overflow-y-auto" aria-label="Sezioni">
						{groups.map((group) => (
							<div key={group.label} className="maxxi-nav-group">
								<p className="maxxi-nav-label">{group.label}</p>
								<ul>
									{group.items.map((item) => (
										<li key={item.href}>
											<Link
												href={item.href}
												className="maxxi-nav-link"
												aria-current={isActive(pathname, item.href) ? "page" : undefined}
											>
												{item.label}
											</Link>
										</li>
									))}
								</ul>
							</div>
						))}
					</nav>

					<div className="maxxi-sidebar-footer">
						<p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#b9b9b3]">
							Demo non ufficiale · dati sintetici
						</p>
						{me && (
							<p className="mt-2 truncate text-[12px] text-[#d9d9d4]">
								<span className="text-white">{me.username}</span>
								{me.roles.length > 0 && (
									<span className="text-[#8f8f89]">
										{" · "}
										{(me.roles as OperatorRole[]).map((role) => labelForRole(role)).join(", ")}
									</span>
								)}
							</p>
						)}
						<button type="button" onClick={() => void logout()} className="maxxi-sidebar-button mt-3">
							<span>Esci</span>
							<span aria-hidden="true">→</span>
						</button>
					</div>
				</aside>

				<div className="min-w-0 flex-1">
					<header className="maxxi-topbar">
						<div className="maxxi-topbar-row">
							<div className="flex min-w-0 items-center gap-3">
								<button
									ref={menuButton}
									type="button"
									className="maxxi-mobile-menu"
									aria-expanded={open}
									aria-controls="maxxi-sidebar"
									aria-label={open ? "Chiudi navigazione" : "Apri navigazione"}
									onClick={() => setOpen((value) => !value)}
								>
									<span aria-hidden="true" className="text-lg leading-none">
										{open ? "×" : "☰"}
									</span>
								</button>
								<p className="maxxi-breadcrumb truncate">
									MAXXI / <span className="text-[var(--maxxi-ink)]">{currentLabel(pathname)}</span>
								</p>
							</div>

							{pathname !== "/maxxi/people" && (
								<form
									role="search"
									onSubmit={(event) => {
										event.preventDefault();
										const query = globalQuery.trim();
										router.push(`/maxxi/people${query ? `?q=${encodeURIComponent(query)}` : ""}`);
									}}
									className="hidden min-w-0 flex-1 justify-center px-4 md:flex"
								>
									<input
										type="search"
										value={globalQuery}
										onChange={(event) => setGlobalQuery(event.target.value)}
										placeholder="Cerca visitatori, email o ID…"
										aria-label="Cerca visitatori"
										className="maxxi-input max-w-xs"
									/>
								</form>
							)}

							<div className="flex items-center gap-3">
								<span className="maxxi-status maxxi-status-neutral">
									Demo · dati sintetici
								</span>
								{me && (
									<span className="hidden text-[12px] text-[var(--maxxi-muted)] sm:inline">
										{me.username}
									</span>
								)}
							</div>
						</div>
						<div className="maxxi-ribbon">
							Demo · dati sintetici · nessun invio esterno
						</div>
					</header>

					<main id="maxxi-main" className="maxxi-content">
						<MaxxiFlow />
						{children}
					</main>
				</div>
			</div>
		</div>
	);
}
