/**
 * Operator session — signed cookie, no client-trusted state.
 *
 * Security gate (SEC-01/SEC-03): every CRM/memory/workspace surface must be
 * closed by default. The demo has exactly one protected operator principal; the
 * password and the signing secret come from the environment, set by the
 * operator, never hardcoded.
 *
 * Token format: base64url(payloadJson) + "." + base64url(hmacSha256).
 * The payload is only a hint; the signature is the authority.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type { OperatorRole } from "./rbac";

export const SESSION_COOKIE = "crm_a_session";
export const SESSION_TTL_SECONDS = 12 * 60 * 60;

/** Opaque IdP ID token, kept only to terminate the Keycloak SSO session. */
export const ID_TOKEN_COOKIE = "crm_a_id_token";
/** Short-lived OIDC state (state + nonce + PKCE verifier + post-login path). */
export const OIDC_STATE_COOKIE = "crm_a_oidc_state";
export const OIDC_STATE_TTL_SECONDS = 10 * 60;

export type OperatorPrincipal = {
  sub: "operator";
  username: string;
  roles: OperatorRole[];
  iat: number;
  exp: number;
};

function b64url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf-8") : input;
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(input: string): Buffer {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  return Buffer.from(padded + pad, "base64");
}

/** Signing secret — operator-provided. Missing => auth is closed (fail-closed). */
export function readSessionSecret(): string | null {
  const secret = process.env.CRM_A_SESSION_SECRET?.trim();
  return secret && secret.length >= 16 ? secret : null;
}

export function signSessionToken(
  username: string,
  roles: OperatorRole[],
  nowMs = Date.now(),
): string | null {
  const secret = readSessionSecret();
  if (!secret) {return null;}
  const iat = Math.floor(nowMs / 1000);
  const payload: OperatorPrincipal = {
    sub: "operator",
    username,
    roles,
    iat,
    exp: iat + SESSION_TTL_SECONDS,
  };
  const body = b64url(JSON.stringify(payload));
  const sig = b64url(createHmac("sha256", secret).update(body).digest());
  return `${body}.${sig}`;
}

export function verifySessionToken(token: string | null | undefined, nowMs = Date.now()): OperatorPrincipal | null {
  const secret = readSessionSecret();
  if (!secret || !token) {return null;}
  const dot = token.lastIndexOf(".");
  if (dot <= 0) {return null;}
  const body = token.slice(0, dot);
  const provided = token.slice(dot + 1);
  const expected = b64url(createHmac("sha256", secret).update(body).digest());
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {return null;}
  try {
    const parsed = JSON.parse(fromB64url(body).toString("utf-8")) as Partial<OperatorPrincipal>;
    if (parsed.sub !== "operator" || typeof parsed.exp !== "number") {return null;}
    if (parsed.exp * 1000 <= nowMs) {return null;}
    return {
      sub: "operator",
      username: typeof parsed.username === "string" ? parsed.username : "",
      roles: Array.isArray(parsed.roles) ? parsed.roles : [],
      iat: Number(parsed.iat ?? 0),
      exp: parsed.exp,
    };
  } catch {
    return null;
  }
}

/** Read a single cookie value from a request without trusting anything else. */
export function readCookie(req: Request, name: string): string | null {
  const cookie = req.headers.get("cookie");
  if (!cookie) {return null;}
  for (const part of cookie.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) {return decodeURIComponent(rest.join("="));}
  }
  return null;
}

/** Read the session cookie from a request. */
export function readSessionFromRequest(req: Request): OperatorPrincipal | null {
  const token = readCookie(req, SESSION_COOKIE);
  return token ? verifySessionToken(token) : null;
}

function isSecureRequest(req: Request): boolean {
  const forwarded = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  return forwarded === "https" || new URL(req.url).protocol === "https:";
}

export function buildCookie(
  req: Request,
  name: string,
  value: string,
  options: { maxAge: number; path?: string; extra?: string },
): string {
  return [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${options.path ?? "/"}`,
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${options.maxAge}`,
    ...(isSecureRequest(req) ? ["Secure"] : []),
    ...(options.extra ? [options.extra] : []),
  ].join("; ");
}

export function clearCookie(req: Request, name: string, path = "/"): string {
  return buildCookie(req, name, "", { maxAge: 0, path });
}

function unauthorized(): Response {
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}

/**
 * Route-handler guard: returns the principal, or a 401 Response to return
 * immediately. Call as: `const auth = requireOperator(req); if (!auth.ok) return auth.response;`
 */
export function requireOperator(
  req: Request,
): { ok: true; principal: OperatorPrincipal } | { ok: false; response: Response } {
  const principal = readSessionFromRequest(req);
  if (!principal) {return { ok: false, response: unauthorized() };}
  return { ok: true, principal };
}

/**
 * True when the request carries the internal service token.
 *
 * This is a *machine* credential for agent tools, deliberately separate from
 * webhook secrets (`CRM_A_PHONE_WEBHOOK_SECRET` is accepted only by the
 * webhook routes that verify it themselves). Rotating one never affects the
 * other.
 */
export function requireService(
  req: Request,
): { ok: true; principal: { sub: "service" } } | { ok: false; response: Response } {
  const header = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  const presented = match?.[1]?.trim() ?? "";
  const secret = process.env.CRM_A_SERVICE_TOKEN?.trim() ?? "";
  if (!secret || presented.length === 0) {
    return { ok: false, response: unauthorized() };
  }
  const a = Buffer.from(presented, "utf-8");
  const b = Buffer.from(secret, "utf-8");
  if (a.length === b.length && timingSafeEqual(a, b)) {
    return { ok: true, principal: { sub: "service" } };
  }
  return { ok: false, response: unauthorized() };
}
