/**
 * POST /api/webhooks/phone — phone-provider integration webhook.
 *
 * The provider runs the call's conversational AI; this console is the CRM
 * brain. One endpoint discriminates on `action`:
 *
 *   - `inbound`   (Atto 1/5)  "who is calling" → resolve/create Person by
 *                             phone, return CRM context for the provider's AI
 *                             to speak.
 *   - `completed` (Atto 1)    end of call → record the `Call` interaction
 *                             (Type=Custom, kind=Call) with transcript/data
 *                             and update the person's anagraphic.
 *   - `message`   (Atto 4)    inbound Telegram message → resolve Person and
 *                             return product/CRM context.
 *
 * Auth: `Authorization: Bearer <secret>` (constant-time compare). Secret from
 * `CRM_A_PHONE_WEBHOOK_SECRET`; endpoint is closed when not configured.
 * Idempotency: `callId` on `completed` is deduped (retries are safe).
 */

import { duckdbQueryAsync } from "@/lib/workspace";
import { loadCrmFieldMaps, sqlString } from "@/lib/crm-queries";
import {
  createOrder,
  normalizeEmail,
  recordEvent,
  updatePersonFields,
} from "@/lib/events";
import {
  buildPhoneContext,
  isPhoneWebhookAuthorized,
  loadLastOrder,
  loadPhonePerson,
  resolvePhonePerson,
  type PhoneContact,
  type PhonePerson,
} from "@/lib/phone-webhook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ACTIONS: Record<string, true> = {
  inbound: true,
  completed: true,
  message: true,
};

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

function personPayload(person: PhonePerson | null) {
  if (!person) {return null;}
  return {
    id: person.id,
    name: person.name,
    email: person.email,
    phone: person.phone,
    status: person.status,
    preferredContact: person.preferredContact,
    lastOrder: person.lastOrder,
  };
}

/** Load the person and attach their most recent order for context. */
async function loadPersonWithOrder(personId: string): Promise<PhonePerson | null> {
  const person = await loadPhonePerson(personId);
  if (!person) {return null;}
  person.lastOrder = await loadLastOrder(personId);
  return person;
}

/**
 * Find an existing interaction (Type=Custom, kind=Call) whose Properties
 * carry the same `callId`. Used to dedupe `completed` retries.
 */
async function findCallInteractionByCallId(callId: string): Promise<string | null> {
  const fieldMaps = await loadCrmFieldMaps();
  const propertiesFieldId = fieldMaps.interaction["Properties"];
  if (!propertiesFieldId) {return null;}
  const safeCallId = callId.replace(/"/g, '""').replace(/'/g, "''");
  const rows = await duckdbQueryAsync<{ entry_id: string }>(
    `SELECT entry_id FROM entry_fields
      WHERE field_id = ${sqlString(propertiesFieldId)}
        AND value LIKE ${sqlString(`%"callId":"${safeCallId}"%`)}
      LIMIT 1;`,
  );
  return rows[0]?.entry_id ?? null;
}

export async function POST(req: Request) {
  if (!isPhoneWebhookAuthorized(req)) {
    return jsonError("Unauthorized", 401);
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonError("Invalid JSON body.", 400);
  }

  const action = typeof body.action === "string" ? body.action.trim() : "";
  if (!ACTIONS[action]) {
    return jsonError(`Unknown action '${action}'.`, 400);
  }

  const from = (body.from ?? {}) as Record<string, unknown>;
  const contact: PhoneContact = {
    phone: typeof from.phone === "string" ? from.phone : undefined,
    name: typeof from.name === "string" ? from.name : null,
    email:
      typeof body.email === "string"
        ? body.email
        : typeof from.email === "string"
          ? from.email
          : null,
  };

  if (action === "inbound" || action === "completed") {
    const resolution = await resolvePhonePerson(contact);
    if (!resolution) {
      return jsonError("Missing or invalid caller phone.", 400);
    }
    const person = await loadPersonWithOrder(resolution.personId);

    if (action === "inbound") {
      return Response.json({
        person: personPayload(person),
        matched: resolution.matched,
        context: buildPhoneContext(person, resolution.matched),
        callStatus: "continue",
      });
    }

    // ── completed ──────────────────────────────────────────────────────
    const callId = typeof body.callId === "string" ? body.callId.trim() : "";
    const duplicate = callId ? await findCallInteractionByCallId(callId) : null;
    if (duplicate) {
      return Response.json({
        ok: true,
        interactionId: duplicate,
        personId: resolution.personId,
        actions: ["duplicate_ignored"],
      });
    }

    const data = (body.data ?? {}) as Record<string, unknown>;
    const durationSec =
      typeof body.durationSec === "number"
        ? body.durationSec
        : typeof data.durationSec === "number"
          ? (data.durationSec as number)
          : 0;

    const transcript =
      Array.isArray(body.transcript)
        ? (body.transcript as unknown[])
        : Array.isArray(data.transcript)
          ? (data.transcript as unknown[])
          : [];

    const properties = {
      kind: "Call",
      channel: "phone",
      callId,
      durationSec,
      transcript,
      summary: typeof data.summary === "string" ? data.summary : null,
    };

    const event = await recordEvent({
      personId: resolution.personId,
      type: "Custom",
      propertiesJson: JSON.stringify(properties),
    });
    if (!event) {
      return jsonError("Failed to record call interaction.", 500);
    }

    const updates: Array<[string, string]> = [];
    const cleanName = typeof data.name === "string" ? data.name.trim() : "";
    if (cleanName) {updates.push(["Full Name", cleanName]);}
    const cleanEmail = normalizeEmail(data.email);
    if (cleanEmail) {updates.push(["Email Address", cleanEmail]);}
    const preferred =
      typeof data.preferredContact === "string" ? data.preferredContact.trim() : "";
    if (preferred === "telegram" || preferred === "email") {
      updates.push(["Preferred Contact Channel", preferred]);
    }
    if (data.marketingOptIn != null) {
      updates.push(["Marketing Opt-in", data.marketingOptIn === true ? "true" : "false"]);
    }
    if (typeof data.summary === "string" && data.summary.trim()) {
      updates.push(["Notes", data.summary.trim()]);
    }
    // Preferred Contact Channel / Marketing Opt-in fields arrive in Fase 2;
    // updatePersonFields skips any field id that doesn't exist yet.
    if (updates.length > 0) {
      await updatePersonFields(resolution.personId, updates);
    }

    const actions = ["interaction_recorded"];
    if (updates.length > 0) {actions.push("person_updated");}

    // Optional order ingestion: if the provider's AI detected a purchase
    // (`data.order`), record a first-class order linked to the person.
    const orderData = (data.order ?? {}) as Record<string, unknown>;
    if (
      orderData.productId != null ||
      orderData.deliveryStatus != null ||
      orderData.amount != null ||
      orderData.status != null
    ) {
      const orderId = await createOrder({
        personId: resolution.personId,
        productId: typeof orderData.productId === "string" ? orderData.productId : null,
        orderedAt:
          typeof orderData.orderedAt === "string" ? orderData.orderedAt : undefined,
        amount: typeof orderData.amount === "number" ? orderData.amount : undefined,
        status: typeof orderData.status === "string" ? orderData.status : undefined,
        courier: typeof orderData.courier === "string" ? orderData.courier : undefined,
        deliveryStatus:
          typeof orderData.deliveryStatus === "string" ? orderData.deliveryStatus : undefined,
        trackingUrl:
          typeof orderData.trackingUrl === "string" ? orderData.trackingUrl : undefined,
      });
      if (orderId) {actions.push("order_created");}
    }

    return Response.json({
      ok: true,
      interactionId: event.eventId,
      personId: resolution.personId,
      actions,
    });
  }

  // ── message (Telegram / chat inbound) ────────────────────────────────
  const contactChan = (body.contact ?? {}) as Record<string, unknown>;
  const msgContact: PhoneContact = {
    phone:
      typeof body.phone === "string"
        ? body.phone
        : typeof contactChan.phone === "string"
          ? (contactChan.phone as string)
          : undefined,
    name:
      typeof contactChan.name === "string" ? (contactChan.name as string) : null,
    email:
      typeof contactChan.email === "string" ? (contactChan.email as string) : null,
  };
  const resolution = await resolvePhonePerson(msgContact);
  if (!resolution) {
    return jsonError("Missing contact phone for message event.", 400);
  }
  const person = await loadPersonWithOrder(resolution.personId);

  const messageText = typeof body.text === "string" ? body.text : "";
  await recordEvent({
    personId: resolution.personId,
    type: "Custom",
    propertiesJson: JSON.stringify({
      kind: "Message",
      channel: "telegram",
      messageId: typeof body.messageId === "string" ? body.messageId : null,
      text: messageText,
    }),
  });

  return Response.json({
    person: personPayload(person),
    matched: resolution.matched,
    context: buildPhoneContext(person, resolution.matched),
    replyFor: "message",
  });
}
