/**
 * POST /api/auth/logout — clears the operator session cookie.
 */

import { SESSION_COOKIE } from "@/lib/security/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  return Response.json(
    { ok: true },
    {
      headers: {
        "set-cookie": `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
      },
    },
  );
}
