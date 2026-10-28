"use client";

import type { ReactNode } from "react";

export const DEMO_BANNER = "DEMO - DATI SINTETICI - NESSUN INVIO ESTERNO";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
	return (
		<div
			className={`rounded-xl border p-4 ${className}`}
			style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
		>
			{children}
		</div>
	);
}

export function SectionTitle({ children, hint }: { children: ReactNode; hint?: string }) {
	return (
		<div className="mb-3">
			<h2 className="text-lg font-semibold" style={{ color: "var(--color-text)" }}>
				{children}
			</h2>
			{hint && (
				<p className="mt-0.5 text-xs" style={{ color: "var(--color-text-muted)" }}>
					{hint}
				</p>
			)}
		</div>
	);
}

export function Kpi({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
	return (
		<Card>
			<p className="text-[11px] uppercase tracking-wider" style={{ color: "var(--color-text-muted)" }}>
				{label}
			</p>
			<p className="mt-1 text-2xl font-semibold tabular-nums" style={{ color: "var(--color-text)" }}>
				{value}
			</p>
			{hint && (
				<p className="mt-1 text-[11px]" style={{ color: "var(--color-text-muted)" }}>
					{hint}
				</p>
			)}
		</Card>
	);
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "ok" | "warn" | "bad" }) {
	const colors: Record<string, string> = {
		neutral: "#94a3b8",
		ok: "#22c55e",
		warn: "#f59e0b",
		bad: "#ef4444",
	};
	const color = colors[tone];
	return (
		<span
			className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
			style={{ background: `${color}1f`, color }}
		>
			{children}
		</span>
	);
}

export function Empty({ children }: { children: ReactNode }) {
	return (
		<p className="py-8 text-center text-sm" style={{ color: "var(--color-text-muted)" }}>
			{children}
		</p>
	);
}

export function Loading({ label = "Caricamento…" }: { label?: string }) {
	return (
		<p className="py-8 text-center text-sm" style={{ color: "var(--color-text-muted)" }}>
			{label}
		</p>
	);
}

export function ErrorNote({ children }: { children: ReactNode }) {
	return (
		<p className="text-sm" style={{ color: "var(--color-error, #ef4444)" }}>
			{children}
		</p>
	);
}

export function DemoNote({ children }: { children: ReactNode }) {
	return (
		<p
			className="mt-2 text-[11px] leading-relaxed"
			style={{ color: "var(--color-text-muted)" }}
		>
			{children}
		</p>
	);
}
