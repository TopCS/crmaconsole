/** GET /api/maxxi/people — list; GET ?id= — person 360. */

import { guard, jsonError } from "../_guard";
import { getPerson360, listPeople } from "@/lib/maxxi/queries";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = guard(req);
  if (!auth.ok) {return auth.response;}

  const url = new URL(req.url);
  const id = url.searchParams.get("id")?.trim();
  const limitRaw = Number(url.searchParams.get("limit") ?? "100");

  try {
    if (id) {
      const person = await getPerson360(id);
      if (!person) {return jsonError("Person not found.", 404);}
      return Response.json({ ok: true, person });
    }
    const people = await listPeople({ limit: Number.isFinite(limitRaw) ? limitRaw : 100 });
    return Response.json({ ok: true, people });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "People query failed." },
      { status: 500 },
    );
  }
}
