/**
 * POST /api/campaigns/telegram-person — send a Telegram message to a person.
 *
 * Resolves the person (by entry id or `Full Name`) and delivers over the
 * OpenClaw runtime on their session: `telegram:<id>` when `Telegram User ID`
 * is on file, else `phone:<e164>` (bot routes to their chat). Powers the chat
 * intent "manda un messaggio Telegram a <persona>".
 *
 * Body:
 *   { "personEntryId": "…", "subject": "…", "body": "…" }
 *   { "personName": "Lorenzo Lorato", "subject": "…", "body": "…" }
 *   { …same…, "preview": true }  → dry-run: nothing delivered, returns the
 *                                   resolved target without sending.
 *
 * Auth: same Bearer secret as the phone webhook (CRM_A_PHONE_WEBHOOK_SECRET).
 */

import { resolvePersonIdByName } from "@/lib/campaign-phone";
import { deliverToSession } from "@/lib/openclaw-send";
import { loadPhonePerson } from "@/lib/phone-webhook";
import { isPhoneWebhookAuthorized } from "@/lib/phone-webhook";
import { normalizePhone } from "@/lib/events";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
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

  const subject = typeof body.subject === "string" ? body.subject.trim() : "";
  const message = typeof body.body === "string" ? body.body.trim() : "";
  if (!message) {
    return jsonError("body is required.", 400);
  }

  let personEntryId = typeof body.personEntryId === "string" ? body.personEntryId.trim() : "";
  const personName = typeof body.personName === "string" ? body.personName.trim() : "";
  if (!personEntryId && personName) {
    personEntryId = (await resolvePersonIdByName(personName)) ?? "";
  }
  if (!personEntryId) {
    return jsonError(
      personName ? `Person "${personName}" not found.` : "personEntryId or personName is required.",
      400,
    );
  }

  const person = await loadPhonePerson(personEntryId);
  if (!person) {
    return jsonError("Person not found.", 404);
  }

  const telegramId = person.telegramUserId?.trim() || null;
  const phone = normalizePhone(person.phone);
  const target = telegramId ? `telegram:${telegramId}` : phone ? `phone:${phone}` : null;

  if (body.preview === true) {
    return Response.json({
      ok: true,
      preview: true,
      person: { id: person.id, name: person.name, telegramUserId: telegramId, phone },
      target,
    });
  }
  if (!target) {
    return jsonError(
      `No Telegram user id or phone on file for ${person.name ?? "this person"}.`,
      400,
    );
  }

  try {
    const res = await deliverToSession({
      sessionKey: target,
      message: `${subject}\n\n${message}`,
    });
    if (!res.ok) {
      return jsonError(res.error ?? "Runtime rejected delivery.", 500);
    }
    return Response.json({ ok: true, delivered: true, target, payload: res.payload });
  } catch (err) {
    return jsonError(
      err instanceof Error ? err.message : "Telegram send failed.",
      500,
    );
  }
}