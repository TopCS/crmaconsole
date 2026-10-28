/** GET /api/auth/me — current operator principal (username + roles). */

import { readSessionFromRequest } from "@/lib/security/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const principal = readSessionFromRequest(req);
  if (!principal) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return Response.json({
    ok: true,
    username: principal.username,
    roles: principal.roles,
  });
}
