/**
 * POST /api/demo/seed — idempotent retail demo seed (Rome Future Week).
 *
 * Populates the CRM with the demo scenario from "Demo per Rome Future Week":
 * a Samsung Galaxy catalog (S27 upcoming launch, S26 available, S25
 * discontinued), a handful of contacts with channel preferences + marketing
 * opt-in (including the protagonist "Lorenzo"), an in-transit order for
 * Lorenzo, and a "Lancio Samsung Galaxy" segment.
 *
 * Idempotent: re-running finds existing people by phone and products by SKU,
 * and upserts. Safe to re-run during demo prep.
 *
 * Auth: same Bearer secret as the phone webhook (CRM_A_PHONE_WEBHOOK_SECRET),
 * so this endpoint is closed unless the demo secret is configured.
 */

import { randomUUID } from "node:crypto";
import {
  findPersonIdByPhone,
  findProductIdBySku,
  createOrder,
  createPersonFromPhone,
  createProduct,
  updatePersonFields,
} from "@/lib/events";
import { duckdbExecOnFileAsync, duckdbPathAsync, duckdbQueryAsync } from "@/lib/workspace";
import { loadCrmFieldMaps, sqlString } from "@/lib/crm-queries";
import { ONBOARDING_OBJECT_IDS } from "@/lib/workspace-schema-migrations";
import { isPhoneWebhookAuthorized } from "@/lib/phone-webhook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

type PersonSeed = {
  phone: string;
  name: string;
  email: string;
  preferredContact: "telegram" | "email";
  marketingOptIn: boolean;
  status: string;
  notes: string;
};

const PEOPLE: PersonSeed[] = [
  {
    phone: "+393312345678",
    name: "Lorenzo",
    email: "lorenzo@example.com",
    preferredContact: "telegram",
    marketingOptIn: true,
    status: "Active",
    notes: "Interessato al Samsung Galaxy. Acquistato S26; attende info sul lancio S27.",
  },
  {
    phone: "+393311223344",
    name: "Giulia",
    email: "giulia@example.com",
    preferredContact: "email",
    marketingOptIn: true,
    status: "Active",
    notes: "Possessore Galaxy S25; alta propensione all'acquisto.",
  },
  {
    phone: "+393322334455",
    name: "Marco",
    email: "marco@example.com",
    preferredContact: "telegram",
    marketingOptIn: true,
    status: "Active",
    notes: "Ha chiesto info sul nuovo Galaxy.",
  },
  {
    phone: "+393333445566",
    name: "Sara",
    email: "sara@example.com",
    preferredContact: "email",
    marketingOptIn: false,
    status: "Lead",
    notes: "Nessun consenso marketing.",
  },
];

/** Resolve or create a seed person by phone, then apply preference fields. */
async function upsertPerson(seed: PersonSeed): Promise<string | null> {
  const existing = await findPersonIdByPhone(seed.phone);
  let personId = existing;
  if (!personId) {
    personId = await createPersonFromPhone(seed.phone, seed.name);
  }
  if (!personId) {return null;}
  await updatePersonFields(personId, [
    ["Full Name", seed.name],
    ["Email Address", seed.email],
    ["Preferred Contact Channel", seed.preferredContact],
    ["Marketing Opt-in", seed.marketingOptIn ? "true" : "false"],
    ["Status", seed.status],
    ["Notes", seed.notes],
  ]);
  return personId;
}

/** Resolve or create a seed product by SKU. */
async function upsertProduct(p: {
  name: string;
  brand: string;
  sku: string;
  price: number;
  availableFrom: string | null;
  status: string;
  marketingMessage?: string;
}): Promise<string | null> {
  const existing = await findProductIdBySku(p.sku);
  if (existing) {return existing;}
  return createProduct({
    name: p.name,
    brand: p.brand,
    sku: p.sku,
    price: p.price,
    availableFrom: p.availableFrom ?? undefined,
    status: p.status,
    marketingMessage: p.marketingMessage,
  });
}

export async function POST(req: Request) {
  if (!isPhoneWebhookAuthorized(req)) {
    return jsonError("Unauthorized", 401);
  }

  const summary: string[] = [];

  // ── Catalog ─────────────────────────────────────────────────────────
  await upsertProduct({
    name: "Samsung Galaxy S27",
    brand: "Samsung",
    sku: "SAM-S27",
    price: 1199,
    availableFrom: "2026-10-18",
    status: "Upcoming",
    marketingMessage:
      "Samsung Galaxy S27 — il nuovo flagship.\n"
      + "**Caratteristiche**: display AMOLED 120Hz, fotocamera principale 200MP con IA, batteria 5500 mAh, ricarica 65W.\n"
      + "**Differenze rispetto a S26**: chip più veloce (+18%), batteria maggiore, sensore fotocamera migliorato in bassa luce.\n"
      + "**Vantaggi**: 7 anni di aggiornamenti, resistenza IP68, ecosistema Galaxy.\n"
      + "**Limiti**: prezzo di fascia alta; la cover non è inclusa.\n"
      + "**Promo lancio**: fino a €150 di bonus permuta per i primi clienti; garantito anche per i possessori di S26.\n"
      + "**Link acquisto**: https://example.com/galaxy-s27",
  });
  const s26 = await upsertProduct({
    name: "Samsung Galaxy S26",
    brand: "Samsung",
    sku: "SAM-S26",
    price: 999,
    availableFrom: null,
    status: "Available",
  });
  await upsertProduct({
    name: "Samsung Galaxy S25",
    brand: "Samsung",
    sku: "SAM-S25",
    price: 899,
    availableFrom: null,
    status: "Discontinued",
  });
  summary.push("products");

  // ── People ──────────────────────────────────────────────────────────
  const lorenzoId = await upsertPerson(PEOPLE[0]);
  for (const seed of PEOPLE.slice(1)) {
    await upsertPerson(seed);
  }
  summary.push("people");

  // ── Lorenzo's in-transit order ──────────────────────────────────────
  if (lorenzoId && s26) {
    const dbPath = await duckdbPathAsync();
    const fieldMaps = await loadCrmFieldMaps();
    const customerFieldId = fieldMaps.order["Customer"];
    const exists = customerFieldId && dbPath
      ? await duckdbQueryAsync<{ entry_id: string }>(
          `SELECT entry_id FROM entry_fields
            WHERE field_id = ${sqlString(customerFieldId)} AND value = ${sqlString(lorenzoId)}
            LIMIT 1;`,
        )
      : [];
    if (exists.length === 0) {
      await createOrder({
        personId: lorenzoId,
        productId: s26,
        orderedAt: "2026-10-12T09:00:00Z",
        amount: 999,
        status: "Shipped",
        courier: "GLS",
        deliveryStatus: "Corriere in carico oggi; consegna prevista domani entro le 18",
        trackingUrl: "https://gls.example/track/DEMO-S26",
      });
      summary.push("order");
    }
  }

  // ── Segment "Lancio Samsung Galaxy" ─────────────────────────────────
  const dbPath2 = await duckdbPathAsync();
  const fieldMaps2 = await loadCrmFieldMaps();
  const segmentNameFieldId = fieldMaps2.segment["Name"];
  if (segmentNameFieldId) {
    const segmentName = "Lancio Samsung Galaxy";
    const existing = await duckdbQueryAsync<{ entry_id: string }>(
      `SELECT entry_id FROM entry_fields
        WHERE field_id = ${sqlString(segmentNameFieldId)} AND value = ${sqlString(segmentName)}
        LIMIT 1;`,
    );
    if (existing.length === 0) {
      const definition = {
        filters: {
          id: "root",
          conjunction: "and",
          rules: [
            {
              id: "r1",
              field: "Marketing Opt-in",
              operator: "is_true",
              value: true,
            },
          ],
        },
      };
      const segmentId = randomUUID();
      const now = new Date().toISOString();
      const statements = [
        `INSERT INTO entries (id, object_id, created_at, updated_at) VALUES (${sqlString(segmentId)}, ${sqlString(ONBOARDING_OBJECT_IDS.segment)}, ${sqlString(now)}, ${sqlString(now)});`,
        `INSERT INTO entry_fields (entry_id, field_id, value) VALUES (${sqlString(segmentId)}, ${sqlString(segmentNameFieldId)}, ${sqlString(segmentName)});`,
      ];
      const filterFieldId = fieldMaps2.segment["Filter"];
      if (filterFieldId) {
        statements.push(
          `INSERT INTO entry_fields (entry_id, field_id, value) VALUES (${sqlString(segmentId)}, ${sqlString(filterFieldId)}, ${sqlString(JSON.stringify(definition))});`,
        );
      }
      if (dbPath2) {
        await duckdbExecOnFileAsync(dbPath2, statements.join("\n"));
        summary.push("segment");
      }
    }
  }

  return Response.json({ ok: true, seeded: summary });
}
