/**
 * Shared helpers for the external phone-provider webhook
 * (`/api/webhooks/phone`).
 *
 * Model: the phone provider runs the conversation AI; this console is the
 * CRM brain. For each inbound event it resolves/creates the Person from the
 * caller's phone number, returns CRM context the provider's AI can speak,
 * and (on call completion) records the interaction + updates the anagraphic.
 *
 * Auth is a single shared Bearer secret compared in constant time (same
 * pattern as `apps/web/app/api/sync/poll-tick/route.ts`).
 */

import { timingSafeEqual } from "node:crypto";
import { duckdbQueryAsync } from "./workspace";
import { loadCrmFieldMaps, sqlString } from "./crm-queries";
import { ONBOARDING_OBJECT_IDS } from "./workspace-schema-migrations";
import {
  createPersonFromPhone,
  findPersonIdByPhone,
  normalizePhone,
} from "./events";

/** Lookup a people entry id by (normalized) phone — no creation. */
export async function lookupPersonIdByPhone(phone: string): Promise<string | null> {
  return findPersonIdByPhone(phone);
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

/** Phone webhook secret, from env. Not configured → endpoint is closed. */
export function readPhoneWebhookSecret(): string | undefined {
  return process.env.CRM_A_PHONE_WEBHOOK_SECRET?.trim() || undefined;
}

function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf-8");
  const bBuf = Buffer.from(b, "utf-8");
  if (aBuf.length !== bBuf.length) {return false;}
  return timingSafeEqual(aBuf, bBuf);
}

function extractBearer(authHeader: string | null): string | null {
  if (!authHeader) {return null;}
  const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  if (!match) {return null;}
  const token = match[1]?.trim();
  return token && token.length > 0 ? token : null;
}

/** True when the request carries a valid Bearer phone-webhook secret. */
export function isPhoneWebhookAuthorized(request: Request): boolean {
  const secret = readPhoneWebhookSecret();
  if (!secret) {return false;}
  const presented = extractBearer(request.headers.get("authorization"));
  if (!presented) {return false;}
  return safeEqual(presented, secret);
}

// ---------------------------------------------------------------------------
// Contact resolution
// ---------------------------------------------------------------------------

export type PhoneContact = {
  phone?: string;
  name?: string | null;
  email?: string | null;
};

export type MatchedKind = "existing" | "created";

/** Resolve or create a Person from a phone number (+ optional name/email). */
export async function resolvePhonePerson(
  contact: PhoneContact,
): Promise<{ personId: string; matched: MatchedKind; phone: string } | null> {
  const phone = normalizePhone(contact.phone);
  if (!phone) {return null;}
  const existing = await findPersonIdByPhone(phone);
  if (existing) {
    return { personId: existing, matched: "existing", phone };
  }
  const personId = await createPersonFromPhone(phone, contact.name ?? undefined);
  if (!personId) {return null;}
  return { personId, matched: "created", phone };
}

// ---------------------------------------------------------------------------
// Person context (the CRM data the provider's AI speaks)
// ---------------------------------------------------------------------------

export type PhoneOrder = {
  id: string;
  productName: string | null;
  orderedAt: string | null;
  status: string | null;
  courier: string | null;
  deliveryStatus: string | null;
};

export type PhonePerson = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  status: string | null;
  preferredContact: string | null;
  marketingOptIn: string | null;
  notes: string | null;
  lastInteractionAt: string | null;
  lastOrder: PhoneOrder | null;
};

/** Load a person's CRM fields for webhook context. Returns null if missing. */
export async function loadPhonePerson(personId: string): Promise<PhonePerson | null> {
  const fieldMaps = await loadCrmFieldMaps();
  const projection = fieldMapProjection(fieldMaps.people, [
    ["Full Name", "name"],
    ["Email Address", "email"],
    ["Phone Number", "phone"],
    ["Status", "status"],
    ["Preferred Contact Channel", "preferredContact"],
    ["Marketing Opt-in", "marketingOptIn"],
    ["Notes", "notes"],
    ["Last Interaction At", "lastInteractionAt"],
  ]);
  const rows = await duckdbQueryAsync<Record<string, string | null>>(
    `SELECT e.id AS entry_id, ${projection.select}
       FROM entries e
       LEFT JOIN entry_fields ef ON ef.entry_id = e.id
      WHERE e.object_id = '${ONBOARDING_OBJECT_IDS.people}' AND e.id = ${sqlString(personId)}
      GROUP BY e.id
      LIMIT 1;`,
  );
  const row = rows[0];
  if (!row || !row.entry_id) {return null;}
  return {
    id: String(row.entry_id),
    name: row.name ?? null,
    email: row.email ?? null,
    phone: row.phone ?? null,
    status: row.status ?? null,
    preferredContact: row.preferredContact ?? null,
    marketingOptIn: row.marketingOptIn ?? null,
    notes: row.notes ?? null,
    lastInteractionAt: row.lastInteractionAt ?? null,
    lastOrder: null,
  };
}

/** Load the most recent order for a person, dereferencing the product name. */
export async function loadLastOrder(personId: string): Promise<PhoneOrder | null> {
  const fieldMaps = await loadCrmFieldMaps();
  const orderMap = fieldMaps.order;
  const customerFieldId = orderMap["Customer"];
  const orderedAtFieldId = orderMap["Ordered At"];
  if (!customerFieldId || !orderedAtFieldId) {return null;}
  const projection = fieldMapProjection(orderMap, [
    ["Product", "productId"],
    ["Ordered At", "orderedAt"],
    ["Status", "status"],
    ["Courier", "courier"],
    ["Delivery Status", "deliveryStatus"],
  ]);
  const rows = await duckdbQueryAsync<Record<string, string | null>>(
    `SELECT e.id AS entry_id, ${projection.select}
       FROM entries e
       LEFT JOIN entry_fields ef ON ef.entry_id = e.id
      WHERE e.object_id = '${ONBOARDING_OBJECT_IDS.order}' AND e.id IN (
        SELECT ef2.entry_id FROM entry_fields ef2
         WHERE ef2.field_id = ${sqlString(customerFieldId)} AND ef2.value = ${sqlString(personId)}
      )
      GROUP BY e.id
      ORDER BY MAX(CASE WHEN ef.field_id = '${orderedAtFieldId}' THEN ef.value END) DESC NULLS LAST
      LIMIT 1;`,
  );
  const row = rows[0];
  if (!row || !row.entry_id) {return null;}

  let productName: string | null = null;
  if (row.productId) {
    const nameFieldId = fieldMaps.product["Name"];
    if (nameFieldId) {
      const prodRows = await duckdbQueryAsync<{ name: string | null }>(
        `SELECT MAX(CASE WHEN ef.field_id = '${nameFieldId}' THEN ef.value END) AS name
           FROM entries e
           LEFT JOIN entry_fields ef ON ef.entry_id = e.id
          WHERE e.object_id = '${ONBOARDING_OBJECT_IDS.product}' AND e.id = ${sqlString(row.productId)}
          GROUP BY e.id LIMIT 1;`,
      );
      productName = prodRows[0]?.name ?? null;
    }
  }

  return {
    id: String(row.entry_id),
    productName,
    orderedAt: row.orderedAt ?? null,
    status: row.status ?? null,
    courier: row.courier ?? null,
    deliveryStatus: row.deliveryStatus ?? null,
  };
}

function fieldMapProjection(
  fieldMap: Record<string, string>,
  aliases: Array<[string, string]>,
): { select: string } {
  const select = aliases
    .map(([fieldName, alias]) => {
      const fieldId = fieldMap[fieldName];
      if (!fieldId) {return `NULL AS "${alias}"`;}
      return `MAX(CASE WHEN ef.field_id = '${fieldId}' THEN ef.value END) AS "${alias}"`;
    })
    .join(",\n      ");
  return { select };
}

/**
 * Build the prose context handed to the provider's AI for an inbound call
 * or message. Concise, speakable, persona-first.
 */
export function buildPhoneContext(person: PhonePerson | null, matched: MatchedKind): string {
  if (!person) {
    return "Contatto sconosciuto: nessun record CRM. Procedi come nuovo cliente.";
  }
  if (matched === "created") {
    return "Nuovo contatto registrato nel CRM. Procedi come nuovo cliente.";
  }
  const parts: string[] = [];
  parts.push(person.name ? `Cliente esistente: ${person.name}.` : "Cliente esistente.");
  if (person.email) {parts.push(`Email: ${person.email}.`);}
  if (person.status) {parts.push(`Stato: ${person.status}.`);}
  if (person.preferredContact) {parts.push(`Preferenza contatto: ${person.preferredContact}.`);}
  if (person.marketingOptIn === "true") {parts.push("Opt-in marketing già concesso.");}
  if (person.lastOrder) {
    const orderParts: string[] = [];
    if (person.lastOrder.productName) {orderParts.push(`ultimo acquisto: ${person.lastOrder.productName}`);}
    if (person.lastOrder.orderedAt) {orderParts.push(`acquistato il ${person.lastOrder.orderedAt.slice(0, 10)}`);}
    if (person.lastOrder.status) {orderParts.push(`stato ordine: ${person.lastOrder.status}`);}
    if (person.lastOrder.courier) {orderParts.push(`corriere: ${person.lastOrder.courier}`);}
    if (person.lastOrder.deliveryStatus) {orderParts.push(person.lastOrder.deliveryStatus);}
    if (orderParts.length > 0) {parts.push(orderParts.join(", ") + ".");}
  }
  if (person.lastInteractionAt) {
    parts.push(`Ultima interazione: ${new Date(person.lastInteractionAt).toISOString().slice(0, 10)}.`);
  }
  if (person.notes) {parts.push(`Note: ${person.notes}.`);}
  return parts.join(" ");
}
