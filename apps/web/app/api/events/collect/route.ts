import { isValidTrackingWriteKey } from "@/lib/tracking";
import {
  createPersonFromEmail,
  findPersonIdByAnonymousId,
  findPersonIdByEmail,
  getAllowedEventTypes,
  isValidEventType,
  normalizeEmail,
  recordEvent,
  resolveShadowPersonId,
} from "@/lib/events";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/events/collect — public web-tracking ingestion.
 *
 * Authenticated by the workspace write key (header `x-write-key` or body
 * field), CORS-open so the tracker snippet can call it from any site.
 *
 * Body: {
 *   anonymousId?: string   // tracker cookie id → shadow person when no email
 *   email?: string         // known identity → resolves/creates real person
 *   type: string           // EVENT_TYPES
 *   occurredAt?: string
 *   properties?: object    // url, title, referrer, utm_*, …
 *   writeKey?: string      // alternative to the x-write-key header
 * }
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, x-write-key",
} as const;

// Best-effort in-memory rate limit: 120 requests/minute per IP. A serverless
// redeploy resets it — fine for a local single-tenant app.
const rateBuckets = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 120;
const RATE_WINDOW_MS = 60_000;

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(ip);
  if (!bucket || bucket.resetAt < now) {
    rateBuckets.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  bucket.count += 1;
  return bucket.count > RATE_LIMIT;
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400, headers: CORS_HEADERS });
  }

  const writeKey = req.headers.get("x-write-key") ?? body.writeKey;
  if (!isValidTrackingWriteKey(writeKey)) {
    return Response.json({ error: "Invalid write key." }, { status: 401, headers: CORS_HEADERS });
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (isRateLimited(ip)) {
    return Response.json({ error: "Rate limited." }, { status: 429, headers: CORS_HEADERS });
  }

  const type = typeof body.type === "string" ? body.type.trim() : "";
  if (!(await isValidEventType(type))) {
    const allowed = await getAllowedEventTypes();
    return Response.json(
      { error: `Unknown event type "${type}". Expected one of: ${allowed.join(", ")}.` },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  const anonymousId = typeof body.anonymousId === "string" ? body.anonymousId.trim() : "";
  const email = normalizeEmail(body.email);
  if (!anonymousId && !email) {
    return Response.json(
      { error: "Provide anonymousId or email." },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  const occurredAt =
    typeof body.occurredAt === "string" && !Number.isNaN(Date.parse(body.occurredAt))
      ? new Date(body.occurredAt).toISOString()
      : new Date().toISOString();

  const propertiesJson =
    body.properties != null && typeof body.properties === "object" && !Array.isArray(body.properties)
      ? JSON.stringify(body.properties)
      : null;

  // Identity resolution: a known email wins over the anonymous shadow.
  let personId: string | null = null;
  let createdPerson = false;
  if (email) {
    personId = await findPersonIdByEmail(email);
    if (!personId) {
      personId = await createPersonFromEmail(email);
      createdPerson = Boolean(personId);
    }
  } else {
    const existingShadow = await findPersonIdByAnonymousId(anonymousId);
    personId = existingShadow ?? (await resolveShadowPersonId(anonymousId));
    createdPerson = !existingShadow && Boolean(personId);
  }
  if (!personId) {
    return Response.json({ error: "Failed to resolve profile." }, { status: 500, headers: CORS_HEADERS });
  }

  const event = await recordEvent({ personId, type, occurredAt, propertiesJson });
  if (!event) {
    return Response.json({ error: "Failed to record event." }, { status: 500, headers: CORS_HEADERS });
  }

  return Response.json(
    { eventId: event.eventId, personId, createdPerson },
    { status: 201, headers: CORS_HEADERS },
  );
}
