"use client";

import type { ReactNode } from "react";

export const DEMO_BANNER = "DEMO - DATI SINTETICI - NESSUN INVIO ESTERNO";

const TONE_CLASS: Record<string, string> = {
	neutral: "maxxi-status-neutral",
	ok: "maxxi-status-ok",
	warn: "maxxi-status-warn",
	bad: "maxxi-status-bad",
};

export function PageHeader({
	eyebrow,
	title,
	subtitle,
	actions,
}: {
	eyebrow?: string;
	title: string;
	subtitle?: ReactNode;
	actions?: ReactNode;
}) {
	return (
		<header className="mb-8 border-b pb-6" style={{ borderColor: "var(--maxxi-line)" }}>
			<div className="flex flex-wrap items-end justify-between gap-4">
				<div className="min-w-0 max-w-3xl">
					{eyebrow && <p className="maxxi-eyebrow">{eyebrow}</p>}
					<h1 className={`maxxi-display ${eyebrow ? "mt-3" : ""}`}>{title}</h1>
					{subtitle && <p className="maxxi-subtitle mt-3 max-w-2xl">{subtitle}</p>}
				</div>
				{actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
			</div>
		</header>
	);
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
	return <div className={`maxxi-card p-4 sm:p-5 ${className}`}>{children}</div>;
}

export function SectionTitle({ children, hint }: { children: ReactNode; hint?: string }) {
	return (
		<div className="mb-4">
			<h2 className="maxxi-section-title">{children}</h2>
			{hint && (
				<p className="mt-1 text-[12.5px] leading-relaxed" style={{ color: "var(--maxxi-muted)" }}>
					{hint}
				</p>
			)}
		</div>
	);
}

export function Kpi({
	label,
	value,
	hint,
	size = "default",
}: {
	label: string;
	value: ReactNode;
	hint?: string;
	size?: "default" | "primary";
}) {
	return (
		<Card>
			<p className="maxxi-eyebrow">{label}</p>
			<p
				className={`maxxi-kpi-value mt-2 ${size === "primary" ? "text-[34px] sm:text-[38px]" : "text-[26px]"}`}
			>
				{value}
			</p>
			{hint && (
				<p className="mt-2 text-[11.5px] leading-snug" style={{ color: "var(--maxxi-muted)" }}>
					{hint}
				</p>
			)}
		</Card>
	);
}

export function Badge({
	children,
	tone = "neutral",
}: {
	children: ReactNode;
	tone?: "neutral" | "ok" | "warn" | "bad";
}) {
	return <span className={`maxxi-status ${TONE_CLASS[tone] ?? TONE_CLASS.neutral}`}>{children}</span>;
}

export function Empty({ children }: { children: ReactNode }) {
	return (
		<p className="py-10 text-center text-sm" style={{ color: "var(--maxxi-muted)" }}>
			{children}
		</p>
	);
}

export function Loading({ label = "Caricamento…" }: { label?: string }) {
	return (
		<div
			role="status"
			aria-live="polite"
			className="maxxi-card px-4 py-10 text-center text-sm"
			style={{ color: "var(--maxxi-muted)" }}
		>
			{label}
		</div>
	);
}

export function ErrorNote({ children }: { children: ReactNode }) {
	return (
		<div
			role="alert"
			className="maxxi-card px-4 py-3 text-sm"
			style={{ borderColor: "var(--maxxi-negative)", color: "var(--maxxi-negative)" }}
		>
			{children}
		</div>
	);
}

export function DemoNote({ children }: { children: ReactNode }) {
	return (
		<p
			className="mt-3 border-t pt-3 text-[11.5px] leading-relaxed"
			style={{ borderColor: "var(--maxxi-line)", color: "var(--maxxi-muted)" }}
		>
			{children}
		</p>
	);
}
