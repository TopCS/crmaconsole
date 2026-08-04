import { randomUUID } from "node:crypto";
import { duckdbExecOnFileAsync, duckdbPathAsync, duckdbQueryAsync } from "./workspace";
import { loadCrmFieldMaps, sqlString } from "./crm-queries";
import { ONBOARDING_OBJECT_IDS } from "./workspace-schema-migrations";

/**
 * Shared CDP event/person write helpers, used by both ingestion surfaces:
 * `/api/crm/events` (server-side, authenticated by the app) and
 * `/api/events/collect` + `/api/events/identify` (public web tracking).
 */

export const EVENT_TYPES = ["Email", "Meeting", "Page View", "Form Submit", "Purchase", "Custom"] as const;

// ── Dynamic event-type validation ─────────────────────────────────────────
// The authoritative list of allowed interaction.Type values is the schema's
// enum (users can add custom event types from the UI). We read it from the
// fields table and cache it per process; the static EVENT_TYPES list is the
// fallback for when the schema row is missing.
const INTERACTION_TYPE_FIELD_ID = "seed_fld_inter_type_00000000000";
let cachedAllowedTypes: string[] | null = null;

export async function getAllowedEventTypes(): Promise<string[]> {
  if (cachedAllowedTypes) {return cachedAllowedTypes;}
  try {
    const rows = await duckdbQueryAsync<{ enum_values: string | null }>(
      `SELECT enum_values FROM fields WHERE id = ${sqlString(INTERACTION_TYPE_FIELD_ID)} LIMIT 1;`,
    );
    const raw = rows[0]?.enum_values;
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed) && parsed.every((v) => typeof v === "string")) {
        cachedAllowedTypes = parsed as string[];
        return cachedAllowedTypes;
      }
    }
  } catch {
    // Fall through to the static list.
  }
  return [...EVENT_TYPES];
}

export async function isValidEventType(type: string): Promise<boolean> {
  return (await getAllowedEventTypes()).includes(type);
}

// Stable seed literals (same ids the sync and strength-score use); the field
// map is consulted first so a migrated/renamed schema still resolves.
const INTERACTION_FIELD_IDS = {
  Type: "seed_fld_inter_type_00000000000",
  "Occurred At": "seed_fld_inter_occurred_0000000",
  Person: "seed_fld_inter_person_000000000",
  Properties: "seed_fld_inter_properties_000",
} as const;

function interactionFieldId(map: Record<string, string>, name: keyof typeof INTERACTION_FIELD_IDS) {
  return map[name] ?? INTERACTION_FIELD_IDS[name];
}

export function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/** Find a people entry id by exact (case-insensitive) email match. */
export async function findPersonIdByEmail(email: string): Promise<string | null> {
  const fieldMaps = await loadCrmFieldMaps();
  const emailFieldId = fieldMaps.people["Email Address"];
  if (!emailFieldId) {return null;}
  const rows = await duckdbQueryAsync<{ entry_id: string }>(
    `SELECT entry_id FROM entry_fields
     WHERE field_id = ${sqlString(emailFieldId)} AND lower(value) = ${sqlString(email)}
     LIMIT 1;`,
  );
  return rows[0]?.entry_id ?? null;
}

/** Find a people entry id by its Anonymous ID field (web-tracking shadow). */
export async function findPersonIdByAnonymousId(anonymousId: string): Promise<string | null> {
  const fieldMaps = await loadCrmFieldMaps();
  const anonFieldId = fieldMaps.people["Anonymous ID"];
  if (!anonFieldId) {return null;}
  const rows = await duckdbQueryAsync<{ entry_id: string }>(
    `SELECT entry_id FROM entry_fields
     WHERE field_id = ${sqlString(anonFieldId)} AND value = ${sqlString(anonymousId)}
     LIMIT 1;`,
  );
  return rows[0]?.entry_id ?? null;
}

async function insertPersonRow(params: {
  personId: string;
  values: Array<[string, string]>;
}): Promise<boolean> {
  const dbPath = await duckdbPathAsync();
  if (!dbPath) {return false;}
  const fieldMaps = await loadCrmFieldMaps();
  const now = new Date().toISOString();
  const statements = [
    `INSERT INTO entries (id, object_id, created_at, updated_at) VALUES (${sqlString(params.personId)}, ${sqlString(ONBOARDING_OBJECT_IDS.people)}, ${sqlString(now)}, ${sqlString(now)});`,
  ];
  for (const [fieldName, value] of params.values) {
    const fieldId = fieldMaps.people[fieldName];
    if (!fieldId) {continue;}
    statements.push(
      `INSERT INTO entry_fields (entry_id, field_id, value) VALUES (${sqlString(params.personId)}, ${sqlString(fieldId)}, ${sqlString(value)});`,
    );
  }
  return duckdbExecOnFileAsync(dbPath, statements.join("\n"));
}

/** Create a real person (Source=Manual) from an email address. */
export async function createPersonFromEmail(email: string): Promise<string | null> {
  const personId = randomUUID();
  const ok = await insertPersonRow({
    personId,
    values: [
      ["Full Name", email],
      ["Email Address", email],
      ["Source", "Manual"],
    ],
  });
  return ok ? personId : null;
}

/**
 * Resolve or create the anonymous "shadow person" for a web-tracking
 * anonymous id (Source=Anonymous, name derived from the id prefix).
 */
export async function resolveShadowPersonId(anonymousId: string): Promise<string | null> {
  const existing = await findPersonIdByAnonymousId(anonymousId);
  if (existing) {return existing;}
  const personId = randomUUID();
  const ok = await insertPersonRow({
    personId,
    values: [
      ["Full Name", `Anonymous ${anonymousId.slice(0, 8)}`],
      ["Anonymous ID", anonymousId],
      ["Source", "Anonymous"],
    ],
  });
  return ok ? personId : null;
}

/** Insert an event (interaction row) linked to a person. */
export async function recordEvent(params: {
  personId: string;
  type: string;
  occurredAt?: string;
  propertiesJson?: string | null;
}): Promise<{ eventId: string } | null> {
  const dbPath = await duckdbPathAsync();
  if (!dbPath) {return null;}

  const fieldMaps = await loadCrmFieldMaps();
  const eventId = randomUUID();
  const now = new Date().toISOString();
  const occurredAt = params.occurredAt ?? now;

  const values: Array<[string, string]> = [
    ["Type", params.type],
    ["Occurred At", occurredAt],
    ["Person", params.personId],
  ];
  if (params.propertiesJson) {
    values.push(["Properties", params.propertiesJson]);
  }

  const statements = [
    `INSERT INTO entries (id, object_id, created_at, updated_at) VALUES (${sqlString(eventId)}, ${sqlString(ONBOARDING_OBJECT_IDS.interaction)}, ${sqlString(now)}, ${sqlString(now)});`,
  ];
  for (const [fieldName, value] of values) {
    const fieldId = interactionFieldId(
      fieldMaps.interaction,
      fieldName as keyof typeof INTERACTION_FIELD_IDS,
    );
    statements.push(
      `INSERT INTO entry_fields (entry_id, field_id, value) VALUES (${sqlString(eventId)}, ${sqlString(fieldId)}, ${sqlString(value)});`,
    );
  }

  const ok = await duckdbExecOnFileAsync(dbPath, statements.join("\n"));
  return ok ? { eventId } : null;
}
