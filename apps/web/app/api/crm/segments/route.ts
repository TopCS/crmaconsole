/**
 * POST /api/crm/segments — validated segment upsert (create or replace by name).
 *
 * Built for the chat agent: the model must never hand-write the `Filter` field.
 * A hand-written filter is JSON with escaping traps — a truncated one (missing
 * closing brace) makes the segment unusable and every campaign send against it
 * fail with "filter non valido". Here the definition is assembled server-side
 * from structured rules, the fields/operators are validated against the same
 * list the builder UI uses, and the value is coerced to the field's type.
 *
 * Body:
 *   { name: "Lancio Samsung Galaxy",
 *     description?: "...",
 *     rules?: [{ field: "Marketing Opt-in", operator: "is_true" },
 *              { field: "Preferred Contact Channel", operator: "is", value: "phone" }],
 *     events?: [{ type: "Purchase", operator: "has", withinDays: 30, minCount: 1 }] }
 *
 * Auth: internal bearer secret (CRM_A_PHONE_WEBHOOK_SECRET).
 */

import { randomUUID } from "node:crypto";
import { duckdbExecOnFileAsync, duckdbPathAsync, duckdbQueryAsync } from "@/lib/workspace";
import { loadCrmFieldMaps, sqlString } from "@/lib/crm-queries";
import { ONBOARDING_OBJECT_IDS } from "@/lib/workspace-schema-migrations";
import { isPhoneWebhookAuthorized } from "@/lib/phone-webhook";
import {
  defaultOperatorForFieldType,
  operatorsForFieldType,
  type FilterOperator,
  type FilterRule,
} from "@/lib/object-filters";
import { listSegmentMembers, type SegmentDefinition, type SegmentEventCondition } from "@/lib/segments";
import { SEGMENT_PEOPLE_FIELDS, SEGMENT_EVENT_TYPES } from "@/lib/segment-fields";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

/** Coerce a rule value to the field's type; returns undefined when invalid. */
function coerceValue(
  type: string,
  raw: unknown,
  enumValues: string[] | undefined,
): { value?: string | number | boolean; error?: string } {
  if (type === "boolean") {
    if (raw === true || raw === false) {
      return { value: raw };
    }
    const s = String(raw ?? "").trim().toLowerCase();
    if (["true", "1", "yes"].includes(s)) {
      return { value: true };
    }
    if (["false", "0", "no"].includes(s)) {
      return { value: false };
    }
    return { error: `expected a boolean (true/false), got ${JSON.stringify(raw)}` };
  }
  if (type === "number") {
    const n = typeof raw === "number" ? raw : Number(String(raw ?? "").trim());
    return Number.isFinite(n) ? { value: n } : { error: `expected a number, got ${JSON.stringify(raw)}` };
  }
  const s = asString(raw);
  if (!s) {
    return { error: "expected a non-empty value" };
  }
  if (enumValues && enumValues.length > 0 && !enumValues.includes(s)) {
    return { error: `expected one of ${enumValues.join(", ")}, got "${s}"` };
  }
  return { value: s };
}

/** Same query the console uses to find a segment by name. */
async function findSegmentIdByName(name: string): Promise<string | null> {
  const nameFld = (await loadCrmFieldMaps()).segment?.["Name"];
  if (!nameFld) {
    return null;
  }
  const rows = await duckdbQueryAsync<{ entry_id: string }>(
    `SELECT ef.entry_id AS entry_id
       FROM entry_fields ef
       JOIN entries e ON e.id = ef.entry_id
      WHERE ef.field_id = ${sqlString(nameFld)} AND lower(ef.value) = ${sqlString(name.toLowerCase())}
        AND e.object_id = ${sqlString(ONBOARDING_OBJECT_IDS.segment)}
      LIMIT 1`,
  );
  return rows[0]?.entry_id ?? null;
}

export async function POST(req: Request) {
  if (!isPhoneWebhookAuthorized(req)) {
    return jsonError("Unauthorized", 401);
  }
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonError("Invalid JSON body.", 400);
  }

  const name = asString(body.name);
  if (!name) {
    return jsonError("name is required.", 400);
  }
  const description = asString(body.description) ?? "";

  const rawRules = Array.isArray(body.rules) ? body.rules : [];
  const rules: FilterRule[] = [];
  for (const [index, raw] of rawRules.entries()) {
    const rule = (raw ?? {}) as Record<string, unknown>;
    const fieldName = asString(rule.field);
    const meta = SEGMENT_PEOPLE_FIELDS.find((f) => f.name.toLowerCase() === (fieldName ?? "").toLowerCase());
    if (!meta) {
      return jsonError(
        `Unknown filter field "${String(rule.field)}". Allowed fields: ${SEGMENT_PEOPLE_FIELDS.map((f) => f.name).join(", ")}.`,
        400,
      );
    }
    const allowed = operatorsForFieldType(meta.type).map((op) => op.value);
    const operator = (asString(rule.operator) ?? defaultOperatorForFieldType(meta.type)) as FilterOperator;
    if (!allowed.includes(operator)) {
      return jsonError(
        `Operator "${operator}" is not valid for ${meta.name} (${meta.type}). Use one of: ${allowed.join(", ")}.`,
        400,
      );
    }
    const needsValue = !["is_empty", "is_not_empty", "is_true", "is_false"].includes(operator);
    let value: string | number | boolean | undefined;
    if (needsValue) {
      const coerced = coerceValue(meta.type, rule.value, meta.enumValues);
      if (coerced.error) {
        return jsonError(`Filter "${meta.name}": ${coerced.error}.`, 400);
      }
      value = coerced.value;
    }
    rules.push({
      id: `r${index + 1}`,
      field: meta.name,
      operator,
      ...(value === undefined ? {} : { value }),
    });
  }

  const rawEvents = Array.isArray(body.events) ? body.events : [];
  const events: SegmentEventCondition[] = [];
  for (const raw of rawEvents) {
    const ev = (raw ?? {}) as Record<string, unknown>;
    const type = asString(ev.type);
    if (!type) {
      return jsonError("Each event condition needs a type.", 400);
    }
    if (!(SEGMENT_EVENT_TYPES as readonly string[]).includes(type)) {
      return jsonError(
        `Unknown event type "${type}". Allowed: ${SEGMENT_EVENT_TYPES.join(", ")}.`,
        400,
      );
    }
    const operator = (asString(ev.operator) ?? "has") as SegmentEventCondition["operator"];
    if (operator !== "has" && operator !== "has_not") {
      return jsonError('Event operator must be "has" or "has_not".', 400);
    }
    events.push({
      type,
      operator,
      ...(typeof ev.withinDays === "number" ? { withinDays: ev.withinDays } : {}),
      ...(typeof ev.minCount === "number" ? { minCount: ev.minCount } : {}),
    });
  }

  if (rules.length === 0 && events.length === 0) {
    return jsonError("At least one filter rule or event condition is required (an empty segment matches everyone).", 400);
  }

  const definition: SegmentDefinition = {
    filters: { id: "root", conjunction: "and", rules },
    ...(events.length > 0 ? { events } : {}),
  };
  const filterJson = JSON.stringify(definition);

  const dbPath = await duckdbPathAsync();
  if (!dbPath) {
    return jsonError("DuckDB not found", 500);
  }
  const fieldMaps = await loadCrmFieldMaps();
  const segmentId = (await findSegmentIdByName(name)) ?? randomUUID();
  const now = new Date().toISOString();

  const nameFld = fieldMaps.segment?.["Name"];
  const descFld = fieldMaps.segment?.["Description"];
  const filterFld = fieldMaps.segment?.["Filter"];
  if (!nameFld || !filterFld) {
    return jsonError("Segment schema is missing Name/Filter fields.", 500);
  }

  const statements: string[] = [
    `INSERT OR IGNORE INTO entries (id, object_id, created_at, updated_at) VALUES (${sqlString(segmentId)}, ${sqlString(ONBOARDING_OBJECT_IDS.segment)}, ${sqlString(now)}, ${sqlString(now)});`,
  ];
  const write = (fieldId: string | undefined, value: string) => {
    if (!fieldId || value === "") {
      return;
    }
    statements.push(
      `DELETE FROM entry_fields WHERE entry_id = ${sqlString(segmentId)} AND field_id = ${sqlString(fieldId)};`,
      `INSERT INTO entry_fields (entry_id, field_id, value) VALUES (${sqlString(segmentId)}, ${sqlString(fieldId)}, ${sqlString(value)});`,
    );
  };
  write(nameFld, name);
  write(descFld, description);
  write(filterFld, filterJson);
  // Membership changed: drop the cached count so the UI recomputes it.
  const cacheFields = [fieldMaps.segment?.["Member Count"], fieldMaps.segment?.["Computed At"]]
    .filter((f): f is string => Boolean(f));
  if (cacheFields.length > 0) {
    statements.push(
      `DELETE FROM entry_fields WHERE entry_id = ${sqlString(segmentId)} AND field_id IN (${cacheFields.map((f) => sqlString(f)).join(",")});`,
    );
  }
  statements.push(`UPDATE entries SET updated_at = ${sqlString(now)} WHERE id = ${sqlString(segmentId)};`);

  const ok = await duckdbExecOnFileAsync(dbPath, statements.join("\n"));
  if (!ok) {
    return jsonError("Failed to write the segment.", 500);
  }

  let members = 0;
  try {
    members = (await listSegmentMembers(definition, { limit: 1 })).total;
  } catch {
    members = 0;
  }

  return Response.json({
    ok: true,
    segmentId,
    name,
    filter: definition,
    members,
  });
}
