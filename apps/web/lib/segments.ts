import { buildWhereClause, type FieldMeta, type FilterGroup } from "./object-filters";
import { duckdbExecOnFileParamsBatchAsync, duckdbPathAsync, duckdbQueryAsync } from "./workspace";
import type { ParameterizedStatement } from "./workspace";
import { loadCrmFieldMaps, sqlString } from "./crm-queries";
import { ONBOARDING_OBJECT_IDS } from "./workspace-schema-migrations";

/**
 * Segment engine for the CDP: a segment is a saved SegmentDefinition
 * (demographic filters over people + event conditions over interactions).
 * Membership is computed on demand — there is no membership table to keep
 * in sync.
 */

export type SegmentEventCondition = {
  /** interaction.Type value, e.g. "Page View". */
  type: string;
  /** "has" = did at least minCount times; "has_not" = did zero times. */
  operator: "has" | "has_not";
  /** Only count events within the last N days. */
  withinDays?: number;
  /** Minimum occurrences for "has" (default 1). */
  minCount?: number;
};

export type SegmentDefinition = {
  filters?: FilterGroup;
  events?: SegmentEventCondition[];
};

function quoteCol(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** People fields exposed to the segment builder (demographics). */
export const SEGMENT_PEOPLE_FIELDS: FieldMeta[] = [
  { name: "Full Name", type: "text" },
  { name: "Email Address", type: "email" },
  { name: "Phone Number", type: "text" },
  { name: "Job Title", type: "text" },
  { name: "LinkedIn URL", type: "url" },
  { name: "Company", type: "relation" },
  { name: "Status", type: "enum" },
  { name: "Source", type: "enum" },
  { name: "Strength Score", type: "number" },
  { name: "Last Interaction At", type: "date" },
];

function buildEventConditionSql(
  condition: SegmentEventCondition,
  ids: { personFieldId: string; typeFieldId: string; occurredFieldId: string; interactionObjectId: string },
): string | null {
  const type = condition.type?.trim();
  if (!type) {return null;}

  const joins = [
    `JOIN entry_fields pt ON pt.entry_id = i.id AND pt.field_id = ${sqlString(ids.personFieldId)} AND pt.value = v.entry_id`,
    `JOIN entry_fields tt ON tt.entry_id = i.id AND tt.field_id = ${sqlString(ids.typeFieldId)} AND tt.value = ${sqlString(type)}`,
  ];
  if (condition.withinDays && condition.withinDays > 0) {
    const cutoff = new Date(Date.now() - condition.withinDays * 86_400_000).toISOString();
    joins.push(
      `JOIN entry_fields ot ON ot.entry_id = i.id AND ot.field_id = ${sqlString(ids.occurredFieldId)} AND ot.value >= ${sqlString(cutoff)}`,
    );
  }
  const countExpr = `(SELECT COUNT(*) FROM entries i ${joins.join(" ")} WHERE i.object_id = ${sqlString(ids.interactionObjectId)})`;

  if (condition.operator === "has_not") {
    return `${countExpr} = 0`;
  }
  const min = Math.max(1, Math.floor(condition.minCount ?? 1));
  return `${countExpr} >= ${min}`;
}

/** Build the full WHERE body (no leading WHERE) for a segment definition. */
export function buildSegmentWhereSql(
  def: SegmentDefinition,
  ids: {
    personFieldId: string;
    typeFieldId: string;
    occurredFieldId: string;
    interactionObjectId: string;
  },
  peopleFields: FieldMeta[] = SEGMENT_PEOPLE_FIELDS,
): string | null {
  const parts: string[] = [];
  const peopleWhere = buildWhereClause(def.filters, peopleFields);
  if (peopleWhere) {parts.push(peopleWhere);}
  for (const condition of def.events ?? []) {
    const sql = buildEventConditionSql(condition, ids);
    if (sql) {parts.push(sql);}
  }
  if (parts.length === 0) {return null;}
  return `(${parts.join(") AND (")})`;
}

async function interactionIds() {
  const fieldMaps = await loadCrmFieldMaps();
  const personFieldId = fieldMaps.interaction["Person"];
  const typeFieldId = fieldMaps.interaction["Type"];
  const occurredFieldId = fieldMaps.interaction["Occurred At"];
  if (!personFieldId || !typeFieldId || !occurredFieldId) {
    throw new Error("Interaction schema is missing Person/Type/Occurred At fields.");
  }
  return {
    personFieldId,
    typeFieldId,
    occurredFieldId,
    interactionObjectId: ONBOARDING_OBJECT_IDS.interaction,
  };
}

export async function computeSegmentCount(def: SegmentDefinition): Promise<number> {
  const ids = await interactionIds();
  const where = buildSegmentWhereSql(def, ids);
  const sql = `SELECT COUNT(*) AS n FROM v_people v${where ? ` WHERE ${where}` : ""};`;
  const rows = await duckdbQueryAsync<{ n: number }>(sql);
  return Number(rows[0]?.n ?? 0);
}

export type SegmentMember = {
  entry_id: string;
  name: string | null;
  email: string | null;
  source: string | null;
  email_status: string | null;
  strength_score: string | null;
  last_interaction_at: string | null;
};

export async function listSegmentMembers(
  def: SegmentDefinition,
  opts: { limit?: number; offset?: number } = {},
): Promise<{ total: number; members: SegmentMember[] }> {
  const ids = await interactionIds();
  const where = buildSegmentWhereSql(def, ids);
  const whereSql = where ? ` WHERE ${where}` : "";
  const limit = Math.max(1, Math.min(200, Math.floor(opts.limit ?? 50)));
  const offset = Math.max(0, Math.floor(opts.offset ?? 0));

  const total = await computeSegmentCount(def);
  const members = await duckdbQueryAsync<SegmentMember>(
    `SELECT v.entry_id,
            v.${quoteCol("Full Name")} AS name,
            v.${quoteCol("Email Address")} AS email,
            v.${quoteCol("Source")} AS source,
            v.${quoteCol("Email Status")} AS email_status,
            v.${quoteCol("Strength Score")} AS strength_score,
            v.${quoteCol("Last Interaction At")} AS last_interaction_at
     FROM v_people v${whereSql}
     ORDER BY TRY_CAST(v.${quoteCol("Strength Score")} AS DOUBLE) DESC NULLS LAST,
              v.${quoteCol("Full Name")} ASC NULLS LAST
     LIMIT ${limit} OFFSET ${offset};`,
  );
  return { total, members };
}

/** Persist the cached Member Count / Computed At back onto the segment entry. */
export async function updateSegmentCache(entryId: string, count: number): Promise<void> {
  const dbPath = await duckdbPathAsync();
  if (!dbPath) {return;}
  const fieldMaps = await loadCrmFieldMaps();
  const countFieldId = fieldMaps.segment["Member Count"];
  const computedFieldId = fieldMaps.segment["Computed At"];
  const now = new Date().toISOString();
  const statements: ParameterizedStatement[] = [];
  for (const [fieldId, value] of [
    [countFieldId, String(count)],
    [computedFieldId, now],
  ] as const) {
    if (!fieldId) {continue;}
    statements.push(
      { sql: `DELETE FROM entry_fields WHERE entry_id = ? AND field_id = ?`, params: [entryId, fieldId] },
      { sql: `INSERT INTO entry_fields (entry_id, field_id, value) VALUES (?, ?, ?)`, params: [entryId, fieldId, value] },
    );
  }
  if (statements.length > 0) {
    await duckdbExecOnFileParamsBatchAsync(dbPath, statements);
  }
}
