import { duckdbQueryAsync } from "@/lib/workspace";
import { requireOperator } from "@/lib/security/session";
import { guardReadOnlySql } from "@/lib/security/sql-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const auth = requireOperator(req);
  if (!auth.ok) {return auth.response;}

  let body: { sql?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const raw = typeof body.sql === "string" ? body.sql : "";
  if (!raw.trim()) {
    return Response.json({ error: "Missing 'sql' field in request body" }, { status: 400 });
  }

  const guard = guardReadOnlySql(raw);
  if (!guard.ok) {
    return Response.json({ error: guard.reason }, { status: 403 });
  }

  try {
    const rows = await duckdbQueryAsync(guard.sql);
    return Response.json({ rows: rows ?? [], ok: true });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Query failed" },
      { status: 500 },
    );
  }
}
