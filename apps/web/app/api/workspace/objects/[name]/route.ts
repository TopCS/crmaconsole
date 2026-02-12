import { duckdbQuery, duckdbPath } from "@/lib/workspace";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ObjectRow = {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  default_view?: string;
  immutable?: boolean;
  created_at?: string;
  updated_at?: string;
};

type FieldRow = {
  id: string;
  name: string;
  type: string;
  description?: string;
  required?: boolean;
  enum_values?: string;
  enum_colors?: string;
  enum_multiple?: boolean;
  related_object_id?: string;
  relationship_type?: string;
  sort_order?: number;
};

type StatusRow = {
  id: string;
  name: string;
  color?: string;
  sort_order?: number;
  is_default?: boolean;
};

type EavRow = {
  entry_id: string;
  created_at: string;
  updated_at: string;
  field_name: string;
  value: string | null;
};

/**
 * Pivot raw EAV rows into one object per entry with field names as keys.
 * Input: [{ entry_id, field_name, value }, ...]
 * Output: [{ entry_id, "Full Name": "Sarah", "Email": "sarah@..." }, ...]
 */
function pivotEavRows(
  rows: EavRow[],
): Record<string, unknown>[] {
  const grouped = new Map<
    string,
    Record<string, unknown>
  >();

  for (const row of rows) {
    let entry = grouped.get(row.entry_id);
    if (!entry) {
      entry = {
        entry_id: row.entry_id,
        created_at: row.created_at,
        updated_at: row.updated_at,
      };
      grouped.set(row.entry_id, entry);
    }
    if (row.field_name) {
      entry[row.field_name] = row.value;
    }
  }

  return Array.from(grouped.values());
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;

  if (!duckdbPath()) {
    return Response.json(
      { error: "DuckDB database not found" },
      { status: 404 },
    );
  }

  // Sanitize name to prevent injection (only allow alphanumeric + underscore)
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    return Response.json(
      { error: "Invalid object name" },
      { status: 400 },
    );
  }

  // Fetch object metadata
  const objects = duckdbQuery<ObjectRow>(
    `SELECT * FROM objects WHERE name = '${name}' LIMIT 1`,
  );

  if (objects.length === 0) {
    return Response.json(
      { error: `Object '${name}' not found` },
      { status: 404 },
    );
  }

  const obj = objects[0];

  // Fetch fields for this object
  const fields = duckdbQuery<FieldRow>(
    `SELECT * FROM fields WHERE object_id = '${obj.id}' ORDER BY sort_order`,
  );

  // Fetch statuses for this object
  const statuses = duckdbQuery<StatusRow>(
    `SELECT * FROM statuses WHERE object_id = '${obj.id}' ORDER BY sort_order`,
  );

  // Try the PIVOT view first, then fall back to raw EAV query + client-side pivot
  let entries: Record<string, unknown>[] = [];

  // Attempt PIVOT view
  const pivotEntries = duckdbQuery(
    `SELECT * FROM v_${name} ORDER BY created_at DESC LIMIT 200`,
  );

  if (pivotEntries.length > 0) {
    entries = pivotEntries;
  } else {
    // Fallback: raw EAV query, then pivot in JS
    const rawRows = duckdbQuery<EavRow>(
      `SELECT e.id as entry_id, e.created_at, e.updated_at,
              f.name as field_name, ef.value
       FROM entries e
       JOIN entry_fields ef ON ef.entry_id = e.id
       JOIN fields f ON f.id = ef.field_id
       WHERE e.object_id = '${obj.id}'
       ORDER BY e.created_at DESC
       LIMIT 5000`,
    );

    entries = pivotEavRows(rawRows);
  }

  // Parse enum JSON strings in fields
  const parsedFields = fields.map((f) => ({
    ...f,
    enum_values: f.enum_values ? tryParseJson(f.enum_values) : undefined,
    enum_colors: f.enum_colors ? tryParseJson(f.enum_colors) : undefined,
  }));

  return Response.json({
    object: obj,
    fields: parsedFields,
    statuses,
    entries,
  });
}

function tryParseJson(value: unknown): unknown {
  if (typeof value !== "string") {return value;}
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
