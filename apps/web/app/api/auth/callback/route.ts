/**
 * GET /api/auth/callback — Keycloak redirect target.
 *
 * Validates the state cookie, exchanges the code (PKCE), verifies the ID token
 * against the realm JWKS, maps realm roles onto the local RBAC matrix, and only
 * then issues the signed console session.
 */

import {
  ID_TOKEN_COOKIE,
  OIDC_STATE_COOKIE,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  buildCookie,
  clearCookie,
  readCookie,
  signSessionToken,
} from "@/lib/security/session";
import {
  displayNameFromClaims,
  exchangeCode,
  fetchJwks,
  readOidcConfig,
  rolesFromClaims,
  verifyAccessToken,
  verifyIdToken,
  type IdTokenClaims,
} from "@/lib/security/oidc";
import { safeNextPath } from "@/lib/security/redirect";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type StatePayload = {
  state?: unknown;
  nonce?: unknown;
  verifier?: unknown;
  next?: unknown;
  createdAt?: unknown;
};

function redirectTo(location: string, cookies: string[] = []): Response {
  const headers = new Headers({ location, "cache-control": "no-store" });
  for (const cookie of cookies) {headers.append("set-cookie", cookie);}
  return new Response(null, { status: 302, headers });
}

function loginError(req: Request, code: string, detail?: string): Response {
  const target = new URLSearchParams({ error: code });
  if (detail) {target.set("detail", detail);}
  // Relative location: never send the browser to the container bind address.
  return redirectTo(`/login?${target.toString()}`, [
    clearCookie(req, OIDC_STATE_COOKIE, "/api/auth"),
  ]);
}

function parseState(raw: string | null): StatePayload | null {
  if (!raw) {return null;}
  try {
    return JSON.parse(raw) as StatePayload;
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const config = readOidcConfig(req);
  if (!config) {
    return redirectTo("/login?error=not_configured");
  }

  // Keycloak can send ?error=access_denied (user cancelled, session expired…).
  const idpError = url.searchParams.get("error");
  if (idpError) {
    return loginError(req, idpError === "access_denied" ? "access_denied" : "idp_error");
  }

  const code = url.searchParams.get("code") ?? "";
  const stateParam = url.searchParams.get("state") ?? "";
  const state = parseState(readCookie(req, OIDC_STATE_COOKIE));

  if (!code || !stateParam || !state) {return loginError(req, "state_missing");}
  if (typeof state.state !== "string" || state.state !== stateParam) {
    return loginError(req, "state_mismatch");
  }
  if (typeof state.nonce !== "string" || typeof state.verifier !== "string") {
    return loginError(req, "state_invalid");
  }
  const createdAt = typeof state.createdAt === "number" ? state.createdAt : 0;
  if (Date.now() - createdAt > 10 * 60 * 1000) {
    return loginError(req, "state_expired");
  }

  const tokens = await exchangeCode(config, {
    code,
    codeVerifier: state.verifier,
  });
  if (!tokens) {return loginError(req, "token_exchange_failed");}

  const keys = await fetchJwks(config);
  if (keys.length === 0) {return loginError(req, "jwks_unavailable");}

  const idClaims = verifyIdToken(tokens.idToken, keys, {
    issuer: config.issuer,
    clientId: config.clientId,
    nonce: state.nonce,
  });
  if (!idClaims) {return loginError(req, "id_token_invalid");}

  // Realm roles are usually in the access token too; union both sources so a
  // realm-side mapper change cannot silently strip a role.
  const accessClaims: IdTokenClaims | null = verifyAccessToken(tokens.accessToken, keys, {
    issuer: config.issuer,
    clientId: config.clientId,
  });
  const roles = rolesFromClaims(idClaims);
  if (accessClaims) {
    for (const role of rolesFromClaims(accessClaims)) {
      if (!roles.includes(role)) {roles.push(role);}
    }
  }

  if (roles.length === 0) {
    return loginError(req, "no_role", displayNameFromClaims(idClaims));
  }

  const username = displayNameFromClaims(idClaims);
  const session = signSessionToken(username, roles);
  if (!session) {return loginError(req, "session_unavailable");}

  const next = safeNextPath(state.next);
  const cookies = [
    buildCookie(req, SESSION_COOKIE, session, { maxAge: SESSION_TTL_SECONDS }),
    buildCookie(req, ID_TOKEN_COOKIE, tokens.idToken, { maxAge: SESSION_TTL_SECONDS }),
    clearCookie(req, OIDC_STATE_COOKIE, "/api/auth"),
  ];
  return redirectTo(next, cookies);
}
