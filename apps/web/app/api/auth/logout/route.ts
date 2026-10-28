/**
 * /api/auth/logout — clears the console session and ends the Keycloak SSO
 * session when OIDC is configured.
 *
 * POST returns the logout URL as JSON (the UI navigates there); GET redirects
 * directly. Without Keycloak the local session is still cleared.
 */

import {
  ID_TOKEN_COOKIE,
  SESSION_COOKIE,
  clearCookie,
  readCookie,
} from "@/lib/security/session";
import { buildLogoutUrl, readOidcConfig } from "@/lib/security/oidc";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function clearedCookies(req: Request): string[] {
  return [clearCookie(req, SESSION_COOKIE), clearCookie(req, ID_TOKEN_COOKIE)];
}

export async function POST(req: Request) {
  const config = readOidcConfig(req);
  const idToken = readCookie(req, ID_TOKEN_COOKIE) ?? undefined;
  const logoutUrl = config ? buildLogoutUrl(config, idToken) : null;
  const headers = new Headers({ "cache-control": "no-store" });
  for (const cookie of clearedCookies(req)) {headers.append("set-cookie", cookie);}
  return Response.json({ ok: true, logoutUrl }, { headers });
}

export async function GET(req: Request) {
  const config = readOidcConfig(req);
  const idToken = readCookie(req, ID_TOKEN_COOKIE) ?? undefined;
  const location = config ? buildLogoutUrl(config, idToken) : "/login";
  const headers = new Headers({ location, "cache-control": "no-store" });
  for (const cookie of clearedCookies(req)) {headers.append("set-cookie", cookie);}
  return new Response(null, { status: 302, headers });
}
