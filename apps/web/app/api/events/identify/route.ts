import { isValidTrackingWriteKey } from "@/lib/tracking";
import { createPersonFromEmail, findPersonIdByAnonymousId, findPersonIdByEmail, normalizeEmail } from "@/lib/events";
import { mergePersonInto } from "@/lib/people-merge";
import { duckdbExecOnFileAsync, duckdbPathAsync } from "@/lib/workspace";
import { loadCrmFieldMaps, sqlString } from "@/lib/crm-queries";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/events/identify — fold an anonymous web-tracking profile into a
 * real person (identity resolution).
 *
 * Body: { anonymousId: string, email: string, traits?: { name?, phone?,
 * jobTitle? } , writeKey? } (write key also accepted as `x-write-key`).
 *
 * Flow: upsert the real person by email → find the anonymous shadow person →
 * merge shadow → real (all historical events re-point onto the real person).
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, x-write-key",
} as const;

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

async function applyTraits(personId: string, traits: Record<string, unknown>) {
  const fieldMaps = await loadCrmFieldMaps();
  const mapping: Array<[string, string]> = [
    ["name", "Full Name"],
    ["phone", "Phone Number"],
    ["jobTitle", "Job Title"],
  ];
  const statements: string[] = [];
  for (const [traitKey, fieldName] of mapping) {
    const value = traits[traitKey];
    const fieldId = fieldMaps.people[fieldName];
    if (typeof value !== "string" || !value.trim() || !fieldId) {continue;}
    statements.push(
      `DELETE FROM entry_fields WHERE entry_id = ${sqlString(personId)} AND field_id = ${sqlString(fieldId)};`,
      `INSERT INTO entry_fields (entry_id, field_id, value) VALUES (${sqlString(personId)}, ${sqlString(fieldId)}, ${sqlString(value.trim())});`,
    );
  }
  if (statements.length === 0) {return;}
  const dbPath = await duckdbPathAsync();
  if (dbPath) {
    await duckdbExecOnFileAsync(dbPath, statements.join("\n"));
  }
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

  const anonymousId = typeof body.anonymousId === "string" ? body.anonymousId.trim() : "";
  const email = normalizeEmail(body.email);
  if (!anonymousId || !email) {
    return Response.json(
      { error: "Provide anonymousId and email." },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  // 1. Upsert the real person.
  let personId = await findPersonIdByEmail(email);
  let createdPerson = false;
  if (!personId) {
    personId = await createPersonFromEmail(email);
    createdPerson = Boolean(personId);
  }
  if (!personId) {
    return Response.json({ error: "Failed to resolve profile." }, { status: 500, headers: CORS_HEADERS });
  }

  // 2. Apply optional traits to the real person.
  if (body.traits && typeof body.traits === "object" && !Array.isArray(body.traits)) {
    await applyTraits(personId, body.traits as Record<string, unknown>);
  }

  // 3. Fold the anonymous shadow into the real person (history follows).
  let merged = false;
  const shadowId = await findPersonIdByAnonymousId(anonymousId);
  if (shadowId && shadowId !== personId) {
    const result = await mergePersonInto({ canonicalId: personId, loserId: shadowId });
    merged = result.ok;
  }

  return Response.json(
    { personId, createdPerson, merged },
    { status: 200, headers: CORS_HEADERS },
  );
}
