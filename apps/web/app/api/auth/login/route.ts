/**
 * POST /api/auth/login — operator login for the demo.
 *
 * Body: { password }
 * Sets an http-only signed session cookie. The password comes from
 * CRM_A_OPERATOR_PASSWORD (operator-provided, never hardcoded); when it is not
 * configured login is disabled and the endpoint fails closed.
 */

import {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  checkOperatorPassword,
  readOperatorPassword,
  signSessionToken,
} from "@/lib/security/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!readOperatorPassword()) {
    return Response.json(
      { error: "Login disabled: CRM_A_OPERATOR_PASSWORD is not configured." },
      { status: 503 },
    );
  }

  let body: { password?: unknown };
  try {
    body = (await req.json()) as { password?: unknown };
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const password = typeof body.password === "string" ? body.password : "";
  if (!password || !checkOperatorPassword(password)) {
    // Uniform delay-ish response; no signal about which part failed.
    return Response.json({ error: "Invalid credentials." }, { status: 401 });
  }

  const token = signSessionToken();
  if (!token) {
    return Response.json(
      { error: "Session unavailable: CRM_A_SESSION_SECRET is not configured." },
      { status: 503 },
    );
  }

  const secure = new URL(req.url).protocol === "https:";
  const cookie = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${SESSION_TTL_SECONDS}`,
    ...(secure ? ["Secure"] : []),
  ].join("; ");

  return Response.json({ ok: true }, { headers: { "set-cookie": cookie } });
}
