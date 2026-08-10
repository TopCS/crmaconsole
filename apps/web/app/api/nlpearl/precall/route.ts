/**
 * GET /api/nlpearl/precall — PreCallAPI target for NLPearl Inbound Pearls.
 *
 * Lookup-only, called by the Pearl's PreCallAPI node BEFORE the conversation,
 * with the caller's phone number. Known callers → 200 with
 * `data: { firstName, context }` (identity + last order / delivery state) so
 * NLPearl takes the apiResult:1 (known) branch; unknown callers → 404 so
 * NLPearl takes the apiResult:2 (unknown) branch of the PreCallAPI node.
 * Never creates a Person (no phantom records for cold callers).
 */

import {
  loadPhonePerson,
  loadLastOrder,
  buildPhoneContext,
  lookupPersonIdByPhone,
} from "@/lib/phone-webhook";
import { readPhoneWebhookSecret } from "@/lib/phone-webhook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  const secret = readPhoneWebhookSecret();
  if (!secret || token !== secret) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const phone = url.searchParams.get("phone")?.trim() || "";
  if (!phone) {
    return Response.json({ error: "Missing phone." }, { status: 400 });
  }

  const personId = await lookupPersonIdByPhone(phone);
  if (!personId) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  const person = await loadPhonePerson(personId);
  if (!person) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  person.lastOrder = await loadLastOrder(personId);

  return Response.json({
    data: {
      firstName: person.name ?? null,
      context: buildPhoneContext(person, "existing"),
    },
  });
}