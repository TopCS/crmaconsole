/**
 * GET /api/maxxi/people
 *   ?id=<personId> → profile 360 (people.read). Infopoint/others without
 *                    feedback.viewNotes see note summaries masked.
 *   (no id)        → list of people (people.read).
 */

import { guardPermission } from "../_guard";
import { getPerson360, listPeople } from "@/lib/maxxi/queries";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = guardPermission(req, "maxxi.people.read");
  if (!auth.ok) {return auth.response;}

  const url = new URL(req.url);
  const id = url.searchParams.get("id")?.trim();
  const limitRaw = Number(url.searchParams.get("limit") ?? "200");
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 120);
  const canViewNotes =
    auth.principal.sub === "operator"
      ? auth.principal.roles.includes("admin") || auth.principal.roles.includes("infopoint")
      : false;

  try {
    if (id) {
      const person = await getPerson360(id);
      if (!person) {return Response.json({ error: "Person not found." }, { status: 404 });}
      if (!canViewNotes) {
        person.feedback = person.feedback.map((case_) => ({ ...case_, summary: "" }));
      }
      return Response.json({ ok: true, person });
    }
    const people = await listPeople({
      limit: Number.isFinite(limitRaw) ? limitRaw : 200,
      search: q,
    });
    return Response.json({ ok: true, people, query: q });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "People query failed." },
      { status: 500 },
    );
  }
}
