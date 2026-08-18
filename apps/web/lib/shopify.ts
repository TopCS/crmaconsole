/**
 * Shopify touchpoint ingestion — "da un touchpoint nasce un record".
 *
 * A Shopify store order webhook is the first touchpoint that materializes a
 * CRM Person: with no record yet, the console resolves/creates the anagraphic
 * (comparing email → phone → name, gap-filling missing fields), records the
 * `Purchase` interaction and creates the linked `order`. Fulfilment
 * (`order/fulfilled`) later updates courier + delivery status on that person's
 * latest order — the memory the phone AI speaks ("in carico oggi, consegna
 * domani").
 *
 * Scope: a purchase materializes **identity only** (Full Name / Email / Phone,
 * gap-filled). It NEVER writes marketing consent or a preferred contact
 * channel — those require an explicit operator action downstream. That keeps
 * the pipeline GDPR-clean: consent is granted by the human, not inferred from
 * an order.
 *
 * Idempotent by Shopify order id (stored in the interaction Properties).
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { duckdbExecOnFileAsync, duckdbPathAsync, duckdbQueryAsync } from "./workspace";
import { loadCrmFieldMaps, sqlString } from "./crm-queries";
import {
  createOrder,
  createPersonFromEmail,
  createPersonFromPhone,
  createProduct,
  findPersonIdByEmail,
  findPersonIdByPhone,
  findProductIdBySku,
  normalizeEmail,
  normalizePhone,
  recordEvent,
  updatePersonFields,
} from "./events";
import { loadLastOrder, loadPhonePerson } from "./phone-webhook";

// ---------------------------------------------------------------------------
// Pure mapping (unit-testable without DB)
// ---------------------------------------------------------------------------

export type ShopifyLineItem = {
  sku: string;
  title: string;
  quantity: number;
  price: string;
};

export type ShopifyFulfillment = {
  trackingCompany: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  /** e.g. "in_transit" | "delivered" — used for the friendly delivery text. */
  status: string | null;
};

export type ShopifyOrderData = {
  shopifyOrderId: string;
  orderNumber: number | null;
  email: string;
  phone: string;
  name: string;
  firstName: string;
  lastName: string;
  codiceFiscale: string;
  piva: string;
  createdAt: string;
  totalPrice: number;
  currency: string;
  status: string;
  lineItems: ShopifyLineItem[];
  fulfillments: ShopifyFulfillment[];
  orderUrl: string | null;
};

function asStr(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** Best-effort person identifiers + Italian tax/business fields from a Shopify order payload. */
function identifiers(body: Record<string, unknown>): {
  email: string;
  phone: string;
  name: string;
  firstName: string;
  lastName: string;
  codiceFiscale: string;
  piva: string;
} {
  const customer = asRecord(body.customer);
  const firstName = asStr(customer.first_name);
  const lastName = asStr(customer.last_name);
  const name = [firstName, lastName].filter(Boolean).join(" ") || asStr(customer.name) || "";
  const email = normalizeEmail(asStr(customer.email) || asStr(body.email));
  const phone = normalizePhone(asStr(customer.phone) || asStr(body.phone));

  // CF / PIVA are not standard Shopify fields — they typically arrive as
  // order note_attributes (cart lines) or customer metafields. Look in both.
  const noteAttrs = noteAttributeMap(body);
  const customerMeta = noteAttributeMap(asRecord(customer.metafields ?? customer.metafield));
  const codiceFiscale = asStr(customerMeta.codice_fiscale ?? customerMeta.cf)
    || asStr(customerMeta["Codice Fiscale"])
    || asStr(noteAttrs.codice_fiscale ?? noteAttrs.cf);
  const piva = asStr(customerMeta.piva ?? customerMeta.partita_iva ?? customerMeta.vat)
    || asStr(customerMeta["Partita IVA"] ?? customerMeta["P.IVA"]) 
    || asStr(noteAttrs.piva ?? noteAttrs.partita_iva);

  return { email, phone, name, firstName, lastName, codiceFiscale, piva };
}

/**
 * Shopify note_attributes / metafields arrive as `[{ name, value }]`.
 * Collapse into a `{ name -> value }` map (case-insensitive keys) so the
 * caller can look up CF / PIVA / custom checkout fields without knowing the
 * exact casing Shopify used.
 */
function noteAttributeMap(source: Record<string, unknown>): Record<string, unknown> {
  const arr = Array.isArray(source) ? source : undefined;
  if (!arr) {return {};}
  const out: Record<string, unknown> = {};
  for (const item of arr) {
    const rec = asRecord(item);
    const rawName = asStr(rec.name);
    if (!rawName) {continue;}
    out[rawName.toLowerCase()] = rec.value;
  }
  return out;
}

/**
 * Map a Shopify `orders/create` (or `order/fulfilled`) webhook body into the
 * normalized shape the CRM ingests. Returns null when the order id is missing
 * (discard — probably not an order topic).
 */
export function mapShopifyOrder(body: unknown): ShopifyOrderData | null {
  const rec = asRecord(body);
  const rawId = rec.id;
  const id = typeof rawId === "string"
    ? rawId.trim()
    : typeof rawId === "number" && Number.isFinite(rawId)
      ? String(rawId)
      : "";
  if (!id) {return null;}

  const { email, phone, name, firstName, lastName, codiceFiscale, piva } = identifiers(rec);
  const createdRaw = asStr(rec.created_at);
  const createdAt = createdRaw && !Number.isNaN(Date.parse(createdRaw))
    ? new Date(createdRaw).toISOString()
    : new Date().toISOString();

  const priceRaw = asStr(rec.total_price) || asStr(rec.current_total_price);
  const totalPrice = Number.parseFloat(priceRaw);
  const orderNumber = typeof rec.order_number === "number" && Number.isFinite(rec.order_number)
    ? rec.order_number
    : null;

  return {
    shopifyOrderId: id,
    orderNumber,
    email,
    phone,
    name,
    firstName,
    lastName,
    codiceFiscale,
    piva,
    createdAt,
    totalPrice: Number.isFinite(totalPrice) ? totalPrice : 0,
    currency: asStr(rec.currency) || "EUR",
    status: financialStatus(asStr(rec.financial_status)),
    lineItems: (Array.isArray(rec.line_items) ? rec.line_items : [])
      .map((raw) => {
        const item = asRecord(raw);
        return {
          sku: asStr(item.sku),
          title: asStr(item.title),
          quantity: typeof item.quantity === "number" ? item.quantity : 1,
          price: asStr(item.price),
        };
      })
      .filter((item) => item.title || item.sku),
    fulfillments: (Array.isArray(rec.fulfillments) ? rec.fulfillments : [])
      .map((raw) => {
        const f = asRecord(raw);
        return {
          trackingCompany: asStr(f.tracking_company) || null,
          trackingNumber: asStr(f.tracking_number) || null,
          trackingUrl: asStr(f.tracking_url) || null,
          status: asStr(f.status) || null,
        };
      })
      .filter((f) => f.trackingCompany || f.trackingNumber || f.status),
    orderUrl: asStr(rec.order_status_url) || null,
  };
}

function financialStatus(v: string): string {
  const s = v.toLowerCase();
  if (["paid", "authorized", "partially_paid"].includes(s)) {return "Paid";}
  if (["voided", "refunded", "partially_refunded"].includes(s)) {return "Refunded";}
  if (["pending", "unpaid"].includes(s)) {return "Pending";}
  return "Paid";
}

/** Friendly delivery text from a Shopify fulfilment status. */
export function deliveryTextFromFulfillment(status: string | null): string | null {
  if (!status) {return null;}
  const s = status.toLowerCase();
  if (s === "delivered") {return "Consegnato.";}
  if (s === "in_transit") {return "Corriere in carico oggi; consegna prevista domani entro le 18.";}
  if (s === "attempted_delivery") {return "Primo tentativo di consegna effettuato.";}
  if (s === "out_for_delivery") {return "In consegna oggi.";}
  if (s === "ready_for_pickup") {return "Disponibile per il ritiro.";}
  return null;
}

// ---------------------------------------------------------------------------
// HMAC verification (Shopify webhook signature)
// ---------------------------------------------------------------------------

/**
 * Verify `X-Shopify-Hmac-Sha256` over the raw request body with the app's
 * API secret. Constant-time compare. Matches Shopify's documented algorithm:
 * base64(HMAC-SHA256(rawBody, apiSecret)).
 */
export function verifyShopifyHmac(rawBody: string, headerValue: string | null, secret: string): boolean {
  if (!headerValue || !rawBody) {return false;}
  const expected = createHmac("sha256", secret).update(rawBody, "utf-8").digest("base64");
  const a = Buffer.from(expected, "utf-8");
  const b = Buffer.from(headerValue.trim(), "utf-8");
  if (a.length !== b.length) {return false;}
  return timingSafeEqual(a, b);
}

// ---------------------------------------------------------------------------
// Commerce person resolution ("confrontando i vari campi")
// ---------------------------------------------------------------------------

export type CommerceMatchKind = "created" | "matched_by_email" | "matched_by_phone";

export type CommerceResolveResult = {
  personId: string;
  matched: CommerceMatchKind;
  email: string;
  phone: string;
};

/**
 * Resolve (or create) the Person behind a purchase, comparing fields:
 * email → phone → create. Gap-fills empty Full Name / Phone on an existing
 * record without overwriting a differing identifier (safe merge). Never
 * writes marketing consent or contact preferences (see module doc).
 */
async function resolveCommercePerson(data: ShopifyOrderData): Promise<CommerceResolveResult | null> {
  if (data.email) {
    const byEmail = await findPersonIdByEmail(data.email);
    if (byEmail) {
      await gapFillPerson(byEmail, data);
      return { personId: byEmail, matched: "matched_by_email", email: data.email, phone: data.phone };
    }
  }

  if (data.phone) {
    const byPhone = await findPersonIdByPhone(data.phone);
    if (byPhone) {
      await gapFillPerson(byPhone, data);
      return { personId: byPhone, matched: "matched_by_phone", email: "", phone: data.phone };
    }
    // New phone, existing email → attach the phone to the known person (single identity).
    const emailId = data.email ? await findPersonIdByEmail(data.email) : null;
    if (emailId) {
      await updatePersonFields(emailId, [["Phone Number", data.phone]]);
      return { personId: emailId, matched: "matched_by_email", email: data.email, phone: data.phone };
    }
  }

  // Nothing to match → create a new profile from whatever identifiers we have.
  const personId = data.email
    ? await createPersonFromEmail(data.email)
    : data.phone
      ? await createPersonFromPhone(data.phone, data.name || undefined)
      : null;
  if (!personId) {return null;}
  const values: Array<[string, string]> = [];
  if (data.name) {values.push(["Full Name", data.name]);}
  if (data.email) {values.push(["Email Address", data.email]);}
  if (data.phone) {values.push(["Phone Number", data.phone]);}
  for (const [fieldName, value] of identityTaxFieldValues(data)) {
    if (value) {values.push([fieldName, value]);}
  }
  if (values.length > 0) {await updatePersonFields(personId, values);}
  return { personId, matched: "created", email: data.email, phone: data.phone };
}

/** Fill only empty Full Name / Phone / Email / name-parts / tax fields — never overwrite a set one. */
async function gapFillPerson(personId: string, data: ShopifyOrderData): Promise<void> {
  const person = await loadPhonePerson(personId);
  if (!person) {return;}
  const updates: Array<[string, string]> = [];
  if (data.name && !person.name) {updates.push(["Full Name", data.name]);}
  if (data.email && !person.email) {updates.push(["Email Address", data.email]);}
  if (data.phone && !person.phone) {updates.push(["Phone Number", data.phone]);}
  for (const [fieldName, value] of identityTaxFieldValues(data)) {
    if (value) {updates.push([fieldName, value]);}
  }
  if (updates.length > 0) {await updatePersonFields(personId, updates);}
}

/**
 * First/Last name + CF/PIVA field values derived from the order. Empty
 * strings are filtered out by the caller so we never write blank rows.
 */
function identityTaxFieldValues(data: ShopifyOrderData): Array<[string, string]> {
  return [
    ["First Name", data.firstName],
    ["Last Name", data.lastName],
    ["Codice Fiscale", data.codiceFiscale],
    ["PIVA", data.piva],
  ];
}

// ---------------------------------------------------------------------------
// Order + product materialization
// ---------------------------------------------------------------------------

/** Resolve (or create) the catalog product for the first line item with a SKU. */
async function resolveProductForLineItem(item: ShopifyLineItem): Promise<string | null> {
  if (!item.sku) {return null;}
  const existing = await findProductIdBySku(item.sku);
  if (existing) {return existing;}
  return createProduct({
    name: item.title || item.sku,
    sku: item.sku,
    price: Number.parseFloat(item.price) || undefined,
    status: "Available",
  });
}

function firstFulfillment(data: ShopifyOrderData): ShopifyFulfillment | null {
  return data.fulfillments[0] ?? null;
}

// ---------------------------------------------------------------------------
// Public ingestion API
// ---------------------------------------------------------------------------

export type ShopifyIngestResult = {
  personId: string;
  matched: CommerceMatchKind;
  createdPerson: boolean;
  eventId: string;
  orderId: string;
  duplicate: boolean;
  productId: string | null;
};

/** Idempotency guard: already ingested this Shopify order id? */
async function findIngestedOrderByShopifyId(shopifyOrderId: string): Promise<string | null> {
  const fieldMaps = await loadCrmFieldMaps();
  const propsFld = fieldMaps.interaction["Properties"];
  if (!propsFld) {return null;}
  const safeId = shopifyOrderId.replace(/"/g, '""');
  const rows = await duckdbQueryAsync<{ entry_id: string }>(
    `SELECT entry_id FROM entry_fields
      WHERE field_id = ${sqlString(propsFld)} AND value LIKE ${sqlString(`%"shopifyOrderId":"${safeId}"%`)}
      LIMIT 1;`,
  );
  return rows[0]?.entry_id ?? null;
}

/**
 * Ingest a Shopify order as a purchase touchpoint. Creates/resolves the
 * person, records the `Purchase` interaction and materializes the order.
 * Idempotent for a given shopifyOrderId.
 */
export async function ingestShopifyOrder(data: ShopifyOrderData): Promise<ShopifyIngestResult> {
  const duplicateEventId = await findIngestedOrderByShopifyId(data.shopifyOrderId);
  if (duplicateEventId) {
    return {
      personId: "",
      matched: "matched_by_email",
      createdPerson: false,
      eventId: duplicateEventId,
      orderId: "",
      duplicate: true,
      productId: null,
    };
  }

  const resolved = await resolveCommercePerson(data);
  if (!resolved) {
    throw new Error("No person identifiers and no name in the Shopify order — cannot create a CRM person.");
  }

  const productId = data.lineItems.length > 0
    ? await resolveProductForLineItem(data.lineItems[0])
    : null;

  const event = await recordEvent({
    personId: resolved.personId,
    type: "Purchase",
    occurredAt: data.createdAt,
    propertiesJson: JSON.stringify({
      channel: "shopify",
      shopifyOrderId: data.shopifyOrderId,
      orderNumber: data.orderNumber,
      amount: data.totalPrice,
      currency: data.currency,
      status: data.status,
      items: data.lineItems.map((it) => ({ sku: it.sku, title: it.title, quantity: it.quantity })),
      url: data.orderUrl,
    }),
  });
  if (!event) {throw new Error("Failed to record Purchase event.");}

  const fulfillment = firstFulfillment(data);
  const orderId = await createOrder({
    personId: resolved.personId,
    productId,
    orderedAt: data.createdAt,
    amount: data.totalPrice,
    status: data.status,
    courier: fulfillment?.trackingCompany ?? undefined,
    trackingUrl: fulfillment?.trackingUrl ?? undefined,
    deliveryStatus: fulfillment ? deliveryTextFromFulfillment(fulfillment.status) ?? undefined : undefined,
  });
  if (!orderId) {throw new Error("Failed to create order.");}

  await updatePersonFields(resolved.personId, [["Last Interaction At", data.createdAt]]);

  return {
    personId: resolved.personId,
    matched: resolved.matched,
    createdPerson: resolved.matched === "created",
    eventId: event.eventId,
    orderId,
    duplicate: false,
    productId,
  };
}

/**
 * Find (never create) the Person behind an order — used by order/fulfilled
 * so a fulfillment arriving without a preceding orders/create (retry, manual
 * admin fulfill, race) can never spawn a phantom record.
 */
async function findCommercePerson(data: ShopifyOrderData): Promise<{ personId: string; email: string; phone: string } | null> {
  if (data.email) {
    const byEmail = await findPersonIdByEmail(data.email);
    if (byEmail) {return { personId: byEmail, email: data.email, phone: data.phone };}
  }
  if (data.phone) {
    const byPhone = await findPersonIdByPhone(data.phone);
    if (byPhone) {return { personId: byPhone, email: "", phone: data.phone };}
  }
  return null;
}

/**
 * Apply a Shopify `order/fulfilled` event: update courier + delivery status
 * on the person's latest order. Find-only — never creates a person or order.
 */
export async function applyShopifyFulfillment(data: ShopifyOrderData): Promise<{ personId: string; updated: boolean }> {
  const resolved = await findCommercePerson(data);
  if (!resolved) {return { personId: "", updated: false };}  // no known customer → nothing to update

  const person = await loadPhonePerson(resolved.personId);
  const lastOrder = person ? await loadLastOrder(resolved.personId) : null;
  const fulfillment = firstFulfillment(data);
  if (!lastOrder || !fulfillment || !lastOrder.id) {return { personId: resolved.personId, updated: false };}

  const updates: Array<[string, string]> = [];
  if (fulfillment.trackingCompany) {updates.push(["Courier", fulfillment.trackingCompany]);}
  if (fulfillment.trackingUrl) {updates.push(["Tracking URL", fulfillment.trackingUrl]);}
  const delivery = deliveryTextFromFulfillment(fulfillment.status);
  if (delivery) {updates.push(["Delivery Status", delivery]);}
  if (updates.length === 0) {return { personId: resolved.personId, updated: false };}

  const ok = await updateOrderFields(lastOrder.id, updates);
  await updatePersonFields(resolved.personId, [["Last Interaction At", data.createdAt]]);
  return { personId: resolved.personId, updated: ok };
}

/** Update arbitrary fields on a given order entry (delete + insert per field). */
async function updateOrderFields(orderId: string, values: Array<[string, string]>): Promise<boolean> {
  const dbPath = await duckdbPathAsync();
  if (!dbPath) {return false;}
  const fieldMaps = await loadCrmFieldMaps();
  const statements: string[] = [];
  for (const [fieldName, value] of values) {
    const fieldId = fieldMaps.order[fieldName];
    if (!fieldId) {continue;}
    statements.push(
      `DELETE FROM entry_fields WHERE entry_id = ${sqlString(orderId)} AND field_id = ${sqlString(fieldId)};`,
      `INSERT INTO entry_fields (entry_id, field_id, value) VALUES (${sqlString(orderId)}, ${sqlString(fieldId)}, ${sqlString(value)});`,
    );
  }
  if (statements.length === 0) {return true;}
  return duckdbExecOnFileAsync(dbPath, statements.join("\n"));
}