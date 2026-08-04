import { duckdbQueryAsync } from "@/lib/workspace";
import { sqlString } from "@/lib/crm-queries";
import { ONBOARDING_OBJECT_IDS } from "@/lib/workspace-schema-migrations";
import {
  createPersonFromEmail,
  findPersonIdByEmail,
  getAllowedEventTypes,
  isValidEventType,
  normalizeEmail,
  recordEvent,
} from "@/lib/events";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/crm/events — CDP event ingestion (server-side, app-authenticated).
 *
 * Records a customer-journey event into the `interaction` object (the same
 * store the Gmail/Calendar sync writes Email/Meeting touchpoints into, and
 * the same one the People profile activity timeline reads).
 *
 * Body:
 *   {
 *     personId?: string        // existing people entry id, or…
 *     personEmail?: string     // …an email to resolve (person is created
 *                              //   with Source=Manual when unknown)
 *     type: string             // one of EVENT_TYPES
 *     occurredAt?: string      // ISO date; defaults to now
 *     properties?: object      // arbitrary JSON payload (page url, amount…)
 *   }
 *
 * Returns 201 { eventId, personId, createdPerson }.
 */
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const type = typeof body.type === "string" ? body.type.trim() : "";
  if (!(await isValidEventType(type))) {
    const allowed = await getAllowedEventTypes();
    return Response.json(
      { error: `Unknown event type "${type}". Expected one of: ${allowed.join(", ")}.` },
      { status: 400 },
    );
  }

  const personIdInput = typeof body.personId === "string" ? body.personId.trim() : "";
  const personEmail = normalizeEmail(body.personEmail);
  if (!personIdInput && !personEmail) {
    return Response.json({ error: "Provide personId or personEmail." }, { status: 400 });
  }

  const occurredAt =
    typeof body.occurredAt === "string" && !Number.isNaN(Date.parse(body.occurredAt))
      ? new Date(body.occurredAt).toISOString()
      : new Date().toISOString();

  let propertiesJson: string | null = null;
  if (body.properties != null) {
    if (typeof body.properties === "object" && !Array.isArray(body.properties)) {
      propertiesJson = JSON.stringify(body.properties);
    } else if (typeof body.properties === "string") {
      propertiesJson = body.properties;
    } else {
      return Response.json({ error: "properties must be an object." }, { status: 400 });
    }
  }

  // ── Resolve the person ────────────────────────────────────────────────
  let personId = personIdInput;
  let createdPerson = false;

  if (personId) {
    const rows = await duckdbQueryAsync<{ id: string }>(
      `SELECT id FROM entries WHERE object_id = ${sqlString(ONBOARDING_OBJECT_IDS.people)} AND id = ${sqlString(personId)} LIMIT 1;`,
    );
    if (rows.length === 0) {
      return Response.json({ error: "Person not found." }, { status: 404 });
    }
  } else {
    personId = (await findPersonIdByEmail(personEmail)) ?? "";
    if (!personId) {
      personId = (await createPersonFromEmail(personEmail)) ?? "";
      createdPerson = Boolean(personId);
    }
    if (!personId) {
      return Response.json({ error: "Failed to create person." }, { status: 500 });
    }
  }

  // ── Insert the event ──────────────────────────────────────────────────
  const event = await recordEvent({ personId, type, occurredAt, propertiesJson });
  if (!event) {
    return Response.json({ error: "Failed to record event." }, { status: 500 });
  }

  return Response.json({ eventId: event.eventId, personId, createdPerson }, { status: 201 });
}
