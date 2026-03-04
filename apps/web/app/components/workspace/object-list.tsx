"use client";

import { useMemo } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Field = {
	id: string;
	name: string;
	type: string;
	enum_values?: string[];
	enum_colors?: string[];
};

type ObjectListProps = {
	objectName: string;
	fields: Field[];
	entries: Record<string, unknown>[];
	titleField?: string;
	subtitleField?: string;
	members?: Array<{ id: string; name: string }>;
	onEntryClick?: (entryId: string) => void;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safeString(val: unknown): string {
	if (val == null) {return "";}
	if (typeof val === "string") {return val;}
	if (typeof val === "number" || typeof val === "boolean" || typeof val === "bigint") {
		return String(val);
	}
	if (typeof val === "object") {return JSON.stringify(val);}
	return "";
}

function resolveTitle(entry: Record<string, unknown>, fields: Field[], titleField?: string): string {
	if (titleField) {
		const val = safeString(entry[titleField]);
		if (val) {return val;}
	}
	const autoField = fields.find((f) =>
		f.type === "text" && /name|title/i.test(f.name),
	) ?? fields.find((f) => f.type === "text");
	return autoField ? safeString(entry[autoField.name]) : safeString(entry.id);
}

function getEnumBadge(
	val: string,
	field: Field,
): { text: string; color: string } | null {
	if (!val || !field.enum_values) {return null;}
	const idx = field.enum_values.indexOf(val);
	const color = idx >= 0 && field.enum_colors?.[idx] ? field.enum_colors[idx] : "#94a3b8";
	return { text: val, color };
}

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------

function ListRow({
	entry,
	fields,
	titleField,
	subtitleField,
	onEntryClick,
}: {
	entry: Record<string, unknown>;
	fields: Field[];
	titleField?: string;
	subtitleField?: string;
	onEntryClick?: (id: string) => void;
}) {
	const entryId = safeString(entry.entry_id ?? entry.id);
	const title = resolveTitle(entry, fields, titleField);

	const subtitle = useMemo(() => {
		if (subtitleField) {
			const val = safeString(entry[subtitleField]);
			if (val) {return val;}
		}
		const autoField = fields.find(
			(f) => f.type === "text" && f.name !== titleField && !/name|title/i.test(f.name),
		);
		return autoField ? safeString(entry[autoField.name]) : undefined;
	}, [entry, fields, titleField, subtitleField]);

	const enumField = fields.find((f) => f.type === "enum" && f.enum_values?.length);
	const enumVal = enumField ? safeString(entry[enumField.name]) : null;
	const badge = enumField && enumVal ? getEnumBadge(enumVal, enumField) : null;

	const dateField = fields.find((f) => f.type === "date");
	const dateVal = dateField ? safeString(entry[dateField.name]) : null;

	return (
		<button
			type="button"
			onClick={() => onEntryClick?.(entryId)}
			className="w-full text-left flex items-center gap-3 px-4 py-3 border-b hover:bg-[var(--color-surface-hover)] transition-colors cursor-pointer group"
			style={{ borderColor: "var(--color-border)" }}
		>
			{/* Checkbox placeholder / bullet */}
			<div
				className="w-2 h-2 rounded-full flex-shrink-0"
				style={{ backgroundColor: badge?.color ?? "var(--color-text-muted)", opacity: 0.6 }}
			/>

			{/* Content */}
			<div className="flex-1 min-w-0">
				<div className="flex items-center gap-2">
					<span
						className="text-[13px] font-medium truncate group-hover:underline"
						style={{ color: "var(--color-text)" }}
					>
						{title || "Untitled"}
					</span>
					{badge && (
						<span
							className="text-[10px] px-2 py-0.5 rounded-full flex-shrink-0"
							style={{ backgroundColor: badge.color, color: "#fff" }}
						>
							{badge.text}
						</span>
					)}
				</div>
				{subtitle && (
					<div
						className="text-[11px] truncate mt-0.5"
						style={{ color: "var(--color-text-muted)" }}
					>
						{subtitle}
					</div>
				)}
			</div>

			{/* Date on the right */}
			{dateVal && (
				<span
					className="text-[11px] flex-shrink-0 tabular-nums"
					style={{ color: "var(--color-text-muted)" }}
				>
					{dateVal.slice(0, 10)}
				</span>
			)}
		</button>
	);
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function ListEmptyState() {
	return (
		<div className="flex flex-col items-center justify-center py-16 gap-2">
			<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: "var(--color-text-muted)", opacity: 0.4 }}>
				<path d="M8 6h13" /><path d="M8 12h13" /><path d="M8 18h13" /><path d="M3 6h.01" /><path d="M3 12h.01" /><path d="M3 18h.01" />
			</svg>
			<span className="text-sm" style={{ color: "var(--color-text-muted)" }}>
				No entries to display in list view.
			</span>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function ObjectList({
	objectName: _objectName,
	fields,
	entries,
	titleField,
	subtitleField,
	members: _members,
	onEntryClick,
}: ObjectListProps) {
	if (entries.length === 0) {
		return <ListEmptyState />;
	}

	return (
		<div
			className="rounded-lg border overflow-hidden"
			style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
		>
			{entries.map((entry) => (
				<ListRow
					key={safeString(entry.entry_id ?? entry.id)}
					entry={entry}
					fields={fields}
					titleField={titleField}
					subtitleField={subtitleField}
					onEntryClick={onEntryClick}
				/>
			))}
		</div>
	);
}
