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

export const SESSION_COOKIE = "crm_a_session";
export const SESSION_TTL_SECONDS = 12 * 60 * 60;

export type OperatorPrincipal = {
  sub: "operator";
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

/** Operator password — operator-provided. Missing => login is disabled. */
export function readOperatorPassword(): string | null {
  const password = process.env.CRM_A_OPERATOR_PASSWORD?.trim();
  return password && password.length >= 8 ? password : null;
}

export function signSessionToken(nowMs = Date.now()): string | null {
  const secret = readSessionSecret();
  if (!secret) {return null;}
  const iat = Math.floor(nowMs / 1000);
  const payload: OperatorPrincipal = { sub: "operator", iat, exp: iat + SESSION_TTL_SECONDS };
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
    return { sub: "operator", iat: Number(parsed.iat ?? 0), exp: parsed.exp };
  } catch {
    return null;
  }
}

/** Constant-time password check. */
export function checkOperatorPassword(candidate: string): boolean {
  const expected = readOperatorPassword();
  if (!expected) {return false;}
  const a = Buffer.from(candidate, "utf-8");
  const b = Buffer.from(expected, "utf-8");
  if (a.length !== b.length) {
    // Still do a comparison to keep timing roughly uniform.
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}

/** Read the session cookie from a request. */
export function readSessionFromRequest(req: Request): OperatorPrincipal | null {
  const cookie = req.headers.get("cookie");
  if (!cookie) {return null;}
  for (const part of cookie.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) {
      return verifySessionToken(decodeURIComponent(rest.join("=")));
    }
  }
  return null;
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
 * Service-to-service guard (webhooks, ingestors, tools). Accepts the shared
 * phone-webhook secret or a dedicated service token. Never accepts the
 * operator cookie.
 */
export function requireService(
  req: Request,
): { ok: true; principal: { sub: "service" } } | { ok: false; response: Response } {
  const header = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  const presented = match?.[1]?.trim() ?? "";
  const accepted = [
    process.env.CRM_A_PHONE_WEBHOOK_SECRET?.trim(),
    process.env.CRM_A_SERVICE_TOKEN?.trim(),
  ].filter((v): v is string => Boolean(v && v.length > 0));
  for (const secret of accepted) {
    const a = Buffer.from(presented, "utf-8");
    const b = Buffer.from(secret, "utf-8");
    if (a.length === b.length && timingSafeEqual(a, b)) {
      return { ok: true, principal: { sub: "service" } };
    }
  }
  return { ok: false, response: unauthorized() };
}
