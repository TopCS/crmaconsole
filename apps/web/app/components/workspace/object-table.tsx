"use client";

import { useState, useMemo } from "react";

type Field = {
  id: string;
  name: string;
  type: string;
  enum_values?: string[];
  enum_colors?: string[];
  enum_multiple?: boolean;
  sort_order?: number;
};

type ObjectTableProps = {
  objectName: string;
  fields: Field[];
  entries: Record<string, unknown>[];
  members?: Array<{ id: string; name: string }>;
};

// --- Sort helpers ---

type SortState = {
  column: string;
  direction: "asc" | "desc";
} | null;

function SortIcon({ active, direction }: { active: boolean; direction: "asc" | "desc" }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ opacity: active ? 1 : 0.3 }}
    >
      {direction === "asc" ? (
        <path d="m5 12 7-7 7 7" />
      ) : (
        <path d="m19 12-7 7-7-7" />
      )}
    </svg>
  );
}

// --- Cell Renderers ---

function EnumBadge({
  value,
  enumValues,
  enumColors,
}: {
  value: string;
  enumValues?: string[];
  enumColors?: string[];
}) {
  const idx = enumValues?.indexOf(value) ?? -1;
  const color = idx >= 0 && enumColors ? enumColors[idx] : "#94a3b8";

  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
      style={{
        background: `${color}20`,
        color: color,
        border: `1px solid ${color}40`,
      }}
    >
      {value}
    </span>
  );
}

function BooleanCell({ value }: { value: unknown }) {
  const isTrue =
    value === true || value === "true" || value === "1" || value === "yes";
  return (
    <span style={{ color: isTrue ? "#22c55e" : "var(--color-text-muted)" }}>
      {isTrue ? "Yes" : "No"}
    </span>
  );
}

function UserCell({
  value,
  members,
}: {
  value: unknown;
  members?: Array<{ id: string; name: string }>;
}) {
  const memberId = String(value);
  const member = members?.find((m) => m.id === memberId);
  return (
    <span className="flex items-center gap-1.5">
      <span
        className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-medium flex-shrink-0"
        style={{
          background: "var(--color-accent)",
          color: "white",
        }}
      >
        {(member?.name ?? memberId).charAt(0).toUpperCase()}
      </span>
      <span className="truncate">{member?.name ?? memberId}</span>
    </span>
  );
}

function CellValue({
  value,
  field,
  members,
}: {
  value: unknown;
  field: Field;
  members?: Array<{ id: string; name: string }>;
}) {
  if (value === null || value === undefined || value === "") {
    return (
      <span style={{ color: "var(--color-text-muted)", opacity: 0.5 }}>
        --
      </span>
    );
  }

  switch (field.type) {
    case "enum":
      return (
        <EnumBadge
          value={String(value)}
          enumValues={field.enum_values}
          enumColors={field.enum_colors}
        />
      );
    case "boolean":
      return <BooleanCell value={value} />;
    case "user":
      return <UserCell value={value} members={members} />;
    case "email":
      return (
        <a
          href={`mailto:${value}`}
          className="underline underline-offset-2"
          style={{ color: "#60a5fa" }}
        >
          {String(value)}
        </a>
      );
    case "date":
      return <span>{String(value)}</span>;
    case "number":
      return <span className="tabular-nums">{String(value)}</span>;
    default:
      return <span className="truncate block max-w-[300px]">{String(value)}</span>;
  }
}

// --- Table Component ---

export function ObjectTable({
  objectName,
  fields,
  entries,
  members,
}: ObjectTableProps) {
  const [sort, setSort] = useState<SortState>(null);

  const handleSort = (column: string) => {
    setSort((prev) => {
      if (prev?.column === column) {
        return prev.direction === "asc"
          ? { column, direction: "desc" }
          : null;
      }
      return { column, direction: "asc" };
    });
  };

  const sortedEntries = useMemo(() => {
    if (!sort) {return entries;}
    return [...entries].toSorted((a, b) => {
      const aVal = String(a[sort.column] ?? "");
      const bVal = String(b[sort.column] ?? "");
      const cmp = aVal.localeCompare(bVal, undefined, { numeric: true });
      return sort.direction === "asc" ? cmp : -cmp;
    });
  }, [entries, sort]);

  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--color-text-muted)", opacity: 0.4 }}>
          <rect width="18" height="18" x="3" y="3" rx="2" />
          <path d="M3 9h18" /><path d="M3 15h18" /><path d="M9 3v18" />
        </svg>
        <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
          No entries in <span className="font-medium" style={{ color: "var(--color-text)" }}>{objectName}</span>
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" style={{ borderCollapse: "separate", borderSpacing: 0 }}>
        <thead>
          <tr>
            {fields.map((field) => (
              <th
                key={field.id}
                className="text-left px-3 py-2.5 font-medium text-xs uppercase tracking-wider cursor-pointer select-none whitespace-nowrap border-b"
                style={{
                  color: "var(--color-text-muted)",
                  borderColor: "var(--color-border)",
                  background: "var(--color-surface)",
                  position: "sticky",
                  top: 0,
                  zIndex: 1,
                }}
                onClick={() => handleSort(field.name)}
              >
                <span className="flex items-center gap-1">
                  {field.name}
                  <SortIcon
                    active={sort?.column === field.name}
                    direction={sort?.column === field.name ? sort.direction : "asc"}
                  />
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedEntries.map((entry, idx) => (
            <tr
              key={String(entry.entry_id ?? idx)}
              className="transition-colors duration-75"
              style={{
                background:
                  idx % 2 === 0 ? "transparent" : "var(--color-surface)",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.background =
                  "var(--color-surface-hover)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.background =
                  idx % 2 === 0 ? "transparent" : "var(--color-surface)";
              }}
            >
              {fields.map((field) => (
                <td
                  key={field.id}
                  className="px-3 py-2 border-b whitespace-nowrap"
                  style={{ borderColor: "var(--color-border)" }}
                >
                  <CellValue
                    value={entry[field.name]}
                    field={field}
                    members={members}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
