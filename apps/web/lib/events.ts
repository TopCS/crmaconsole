import { randomUUID } from "node:crypto";
import { duckdbExecOnFileAsync, duckdbExecOnFileParamsBatchAsync, duckdbPathAsync, duckdbQueryAsync } from "./workspace";
import type { ParameterizedStatement } from "./workspace";
import { loadCrmFieldMaps, sqlString } from "./crm-queries";
import { ONBOARDING_OBJECT_IDS } from "./workspace-schema-migrations";
import { roundScore, scoreEventInteraction } from "./strength-score";

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
    const rows = await duckdbQueryAsync<{ enum_values: string | string[] | null }>(
      `SELECT enum_values FROM fields WHERE id = ${sqlString(INTERACTION_TYPE_FIELD_ID)} LIMIT 1;`,
    );
    // DuckDB's -json output emits JSON columns natively: enum_values may
    // already be an array, or a JSON string needing a parse.
    const raw = rows[0]?.enum_values;
    const parsed: unknown = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (Array.isArray(parsed) && parsed.length > 0 && parsed.every((v) => typeof v === "string")) {
      cachedAllowedTypes = parsed as string[];
      return cachedAllowedTypes;
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
  "Score Contribution": "seed_fld_inter_score_0000000000",
} as const;

function interactionFieldId(map: Record<string, string>, name: keyof typeof INTERACTION_FIELD_IDS) {
  return map[name] ?? INTERACTION_FIELD_IDS[name];
}

/** Days elapsed since an ISO timestamp, clamped to ≥ 0. */
function ageDays(iso: string): number {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) {return 0;}
  return Math.max(0, (Date.now() - ms) / 86_400_000);
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

/**
 * Normalize a phone number for storage/lookup: strip spaces, dashes,
 * parentheses and dots, keep an optional leading `+` (E.164). Empty input
 * yields `""`.
 */
export function normalizePhone(value: unknown): string {
  if (typeof value !== "string") {return "";}
  const s = value.trim().replace(/[\s\-().]/g, "");
  return s;
}

/** Find a people entry id by exact (normalized) phone match. */
export async function findPersonIdByPhone(phone: string): Promise<string | null> {
  const fieldMaps = await loadCrmFieldMaps();
  const phoneFieldId = fieldMaps.people["Phone Number"];
  if (!phoneFieldId) {return null;}
  const rows = await duckdbQueryAsync<{ entry_id: string }>(
    `SELECT entry_id FROM entry_fields
     WHERE field_id = ${sqlString(phoneFieldId)} AND value = ${sqlString(phone)}
     LIMIT 1;`,
  );
  return rows[0]?.entry_id ?? null;
}

/** Create a real person (Source=Manual) from a phone number. */
export async function createPersonFromPhone(
  phone: string,
  name?: string,
): Promise<string | null> {
  const personId = randomUUID();
  const values: Array<[string, string]> = [
    ["Phone Number", phone],
    ["Source", "Manual"],
  ];
  const cleanName = name?.trim();
  if (cleanName) {
    values.push(["Full Name", cleanName]);
  }
  const ok = await insertPersonRow({ personId, values });
  return ok ? personId : null;
}

/** Upsert field values onto an existing person (delete + insert per field). */
export async function updatePersonFields(
  personId: string,
  values: Array<[string, string]>,
): Promise<boolean> {
  const dbPath = await duckdbPathAsync();
  if (!dbPath) {return false;}
  const fieldMaps = await loadCrmFieldMaps();
  const statements: string[] = [];
  for (const [fieldName, value] of values) {
    const fieldId = fieldMaps.people[fieldName];
    if (!fieldId) {continue;}
    statements.push(
      `DELETE FROM entry_fields WHERE entry_id = ${sqlString(personId)} AND field_id = ${sqlString(fieldId)};`,
      `INSERT INTO entry_fields (entry_id, field_id, value) VALUES (${sqlString(personId)}, ${sqlString(fieldId)}, ${sqlString(value)});`,
    );
  }
  if (statements.length === 0) {return true;}
  return duckdbExecOnFileAsync(dbPath, statements.join("\n"));
}

/** Create an order linked to a person (optional product + delivery fields). */
export async function createOrder(params: {
  personId: string;
  productId?: string | null;
  orderedAt?: string;
  amount?: number;
  status?: string;
  courier?: string;
  deliveryStatus?: string;
  trackingUrl?: string;
}): Promise<string | null> {
  const dbPath = await duckdbPathAsync();
  if (!dbPath) {return null;}
  const fieldMaps = await loadCrmFieldMaps();
  const orderId = randomUUID();
  const now = new Date().toISOString();

  const values: Array<[string, string]> = [["Customer", params.personId]];
  if (params.productId) {values.push(["Product", params.productId]);}
  if (params.orderedAt) {values.push(["Ordered At", params.orderedAt]);}
  if (params.amount != null) {values.push(["Amount", String(params.amount)]);}
  if (params.status) {values.push(["Status", params.status]);}
  if (params.courier) {values.push(["Courier", params.courier]);}
  if (params.deliveryStatus) {values.push(["Delivery Status", params.deliveryStatus]);}
  if (params.trackingUrl) {values.push(["Tracking URL", params.trackingUrl]);}

  const statements: ParameterizedStatement[] = [
    { sql: `INSERT INTO entries (id, object_id, created_at, updated_at) VALUES (?, ?, ?, ?)`, params: [orderId, ONBOARDING_OBJECT_IDS.order, now, now] },
  ];
  for (const [fieldName, value] of values) {
    const fieldId = fieldMaps.order[fieldName];
    if (!fieldId) {continue;}
    statements.push(
      { sql: `INSERT INTO entry_fields (entry_id, field_id, value) VALUES (?, ?, ?)`, params: [orderId, fieldId, value] },
    );
  }
  const ok = await duckdbExecOnFileParamsBatchAsync(dbPath, statements);
  return ok ? orderId : null;
}

/** Find a catalog product id by exact SKU match. */
export async function findProductIdBySku(sku: string): Promise<string | null> {
  const fieldMaps = await loadCrmFieldMaps();
  const skuFieldId = fieldMaps.product["SKU"];
  if (!skuFieldId) {return null;}
  const rows = await duckdbQueryAsync<{ entry_id: string }>(
    `SELECT entry_id FROM entry_fields
     WHERE field_id = ${sqlString(skuFieldId)} AND value = ${sqlString(sku)}
     LIMIT 1;`,
  );
  return rows[0]?.entry_id ?? null;
}

/** Create a catalog product. */
export async function createProduct(params: {
  name: string;
  brand?: string;
  sku?: string;
  price?: number;
  availableFrom?: string;
  status?: string;
  marketingMessage?: string;
}): Promise<string | null> {
  const dbPath = await duckdbPathAsync();
  if (!dbPath) {return null;}
  const fieldMaps = await loadCrmFieldMaps();
  const productId = randomUUID();
  const now = new Date().toISOString();

  const values: Array<[string, string]> = [["Name", params.name]];
  if (params.brand) {values.push(["Brand", params.brand]);}
  if (params.sku) {values.push(["SKU", params.sku]);}
  if (params.price != null) {values.push(["Price", String(params.price)]);}
  if (params.availableFrom) {values.push(["Available From", params.availableFrom]);}
  if (params.status) {values.push(["Status", params.status]);}
  if (params.marketingMessage) {values.push(["Marketing Message", params.marketingMessage]);}

  const statements = [
    `INSERT INTO entries (id, object_id, created_at, updated_at) VALUES (${sqlString(productId)}, ${sqlString(ONBOARDING_OBJECT_IDS.product)}, ${sqlString(now)}, ${sqlString(now)});`,
  ];
  for (const [fieldName, value] of values) {
    const fieldId = fieldMaps.product[fieldName];
    if (!fieldId) {continue;}
    statements.push(
      `INSERT INTO entry_fields (entry_id, field_id, value) VALUES (${sqlString(productId)}, ${sqlString(fieldId)}, ${sqlString(value)});`,
    );
  }
  const ok = await duckdbExecOnFileAsync(dbPath, statements.join("\n"));
  return ok ? productId : null;
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

  // Score CDP events (Purchase, Call, …) so buying/direct-conversation signals
  // aggregate into the person's Strength Score instead of leaving them "Cold".
  const score = roundScore(
    scoreEventInteraction(params.type, ageDays(occurredAt)),
  );
  if (score > 0) {
    values.push(["Score Contribution", String(score)]);
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
