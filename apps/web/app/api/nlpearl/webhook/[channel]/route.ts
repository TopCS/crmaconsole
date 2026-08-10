/**
 * POST /api/nlpearl/webhook/[channel] — NLPearl call/lead outcome webhooks.
 *
 * Called by NLPearl when a call/lead status changes, secured by a `token`
 * query param (shared secret). No custom NLPearl auth headers, so the token
 * embedded in the URL (see `buildNlpearlCallbackUrls`) is the only auth.
 *
 * The harness records an `interaction` for each event and resolves/updates
 * the relevant Person by phone number. Idempotent by call/lead id:
 * duplicate deliveries are silently accepted.
 */

import { duckdbQueryAsync } from "@/lib/workspace";
import { loadCrmFieldMaps, sqlString } from "@/lib/crm-queries";
import {
  classifyCallConversationStatus,
  mapNlpearlLeadStatus,
} from "@/lib/nlpearl-status";
import type { NlpearlCallWebhook, NlpearlLeadWebhook } from "@/lib/nlpearl";
import {
  normalizePhone,
  recordEvent,
  findPersonIdByPhone,
  createPersonFromPhone,
  updatePersonFields,
} from "@/lib/events";
import { readPhoneWebhookSecret } from "@/lib/phone-webhook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

function verifyToken(req: Request): boolean {
  const token = new URL(req.url).searchParams.get("token");
  const secret = readPhoneWebhookSecret();
  if (!secret) {return false;}
  return typeof token === "string" && token.length > 0 && token === secret;
}

/** Idempotency guard: already have an interaction for this call/lead id? */
async function interactionExistsByProps(
  callId?: string,
  leadId?: string,
): Promise<string | null> {
  const fieldMaps = await loadCrmFieldMaps();
  const propsFieldId = fieldMaps.interaction["Properties"];
  if (!propsFieldId) {return null;}
  const key = callId ?? leadId;
  if (!key) {return null;}
  const safeKey = key.replace(/"/g, '""').replace(/'/g, "''");
  const rows = await duckdbQueryAsync<{ entry_id: string }>(
    `SELECT entry_id FROM entry_fields
      WHERE field_id = ${sqlString(propsFieldId)}
        AND value LIKE ${sqlString(`%"${safeKey}"%`)}
      LIMIT 1;`,
  );
  return rows[0]?.entry_id ?? null;
}

async function handleCallWebhook(payload: NlpearlCallWebhook) {
  const duplicate = await interactionExistsByProps(payload.id, undefined);
  if (duplicate) {
    return Response.json({ ok: true, duplicate: true, interactionId: duplicate });
  }
  const phone = normalizePhone(payload.from) || normalizePhone(payload.to);
  const personId = phone
    ? ((await findPersonIdByPhone(phone)) ?? (await createPersonFromPhone(phone, payload.name ?? undefined)))
    : null;
  if (!personId) {
    return Response.json({ ok: true, warning: "no_phone" });
  }

  const outcome = classifyCallConversationStatus(payload.conversationStatus);
  const event = await recordEvent({
    personId,
    type: "Call",
    propertiesJson: JSON.stringify({
      kind: "CallWebhook",
      nlpearlCallId: payload.id,
      pearlId: payload.pearlId,
      from: payload.from,
      to: payload.to,
      conversationStatus: payload.conversationStatus,
      status: payload.status,
      duration: payload.duration,
      summary: payload.summary ?? null,
      sentiment: payload.overallSentiment ?? null,
      outcome,
      leadId: payload.leadId ?? null,
    }),
  });
  if (!event) {return jsonError("Failed to record interaction.", 500);}
  await updatePersonFields(personId, [
    ["Last Interaction At", new Date().toISOString()],
  ]);
  return Response.json({ ok: true, interactionId: event.eventId, personId });
}

async function handleLeadWebhook(payload: NlpearlLeadWebhook) {
  const duplicate = await interactionExistsByProps(undefined, payload.id);
  if (duplicate) {
    return Response.json({ ok: true, duplicate: true, interactionId: duplicate });
  }
  const phone = normalizePhone(payload.phoneNumber);
  const personId = phone
    ? ((await findPersonIdByPhone(phone)) ?? (await createPersonFromPhone(phone)))
    : null;
  if (!personId) {
    return Response.json({ ok: true, warning: "no_phone" });
  }

  const sendStatus = mapNlpearlLeadStatus(payload.status);
  const event = await recordEvent({
    personId,
    type: "Custom",
    propertiesJson: JSON.stringify({
      kind: "LeadStatusChange",
      nlpearlLeadId: payload.id,
      pearlId: payload.pearlId,
      externalId: payload.externalId ?? null,
      phoneNumber: payload.phoneNumber,
      status: payload.status,
      sendStatus,
      callData: payload.callData ?? null,
      collectedData: payload.collectedData ?? null,
    }),
  });
  if (!event) {return jsonError("Failed to record interaction.", 500);}
  await updatePersonFields(personId, [
    ["Last Interaction At", new Date().toISOString()],
  ]);
  return Response.json({ ok: true, interactionId: event.eventId, personId, sendStatus });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ channel: string }> },
) {
  if (!verifyToken(req)) {
    return jsonError("Unauthorized", 401);
  }
  const { channel } = await params;
  if (channel !== "call" && channel !== "lead") {
    return jsonError("Unknown channel.", 400);
  }
  let body: unknown;
  try {
    body = (await req.json()) as unknown;
  } catch {
    return jsonError("Invalid JSON body.", 400);
  }
  if (channel === "call") {
    return handleCallWebhook(body as NlpearlCallWebhook);
  }
  return handleLeadWebhook(body as NlpearlLeadWebhook);
}
