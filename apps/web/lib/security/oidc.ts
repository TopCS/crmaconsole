/**
 * OIDC / Keycloak integration for CRM-A.
 *
 * Keycloak owns identity and role assignment; the console only *consumes*
 * them. We use the Authorization Code flow with PKCE (S256) and keep the
 * application session cookie signed by `session.ts`, so the rest of the
 * security gate (middleware, guards, audit) does not change.
 *
 * Trust rules:
 *   - the ID token signature is verified against the realm JWKS (RS256);
 *   - `iss`, `aud`/`azp`, `exp` and `nonce` are all checked;
 *   - only roles present in the local RBAC matrix are accepted;
 *   - a user with no CRM-A role is not allowed in (fail-closed).
 *
 * Network note: the browser talks to `issuer`, the server may talk to
 * `internalIssuer` (e.g. http://keycloak:8080 inside Docker). The `iss` claim
 * is always compared with the public issuer.
 */

import { createHash, createPublicKey, randomBytes, verify as cryptoVerify } from "node:crypto";
import { isRole, type OperatorRole } from "./rbac";

export type OidcConfig = {
  /** Public issuer, e.g. http://localhost:8080/realms/crm-a */
  issuer: string;
  /** Server-side base URL for token/JWKS calls (defaults to issuer). */
  internalIssuer: string;
  clientId: string;
  clientSecret: string;
  /** Public callback URL registered in Keycloak. */
  redirectUri: string;
  /** Where Keycloak sends the user after logout. */
  postLogoutRedirectUri: string;
  scopes: string;
};

export type OidcTokens = {
  accessToken: string;
  idToken: string;
  refreshToken?: string;
  expiresIn?: number;
};

export type IdTokenClaims = {
  iss?: string;
  aud?: string | string[];
  azp?: string;
  exp?: number;
  iat?: number;
  nonce?: string;
  sub?: string;
  preferred_username?: string;
  email?: string;
  name?: string;
  realm_access?: { roles?: unknown };
};

export type Jwk = { kid?: string; kty?: string; alg?: string; use?: string; n?: string; e?: string };

const ISSUER_TRAILING_SLASH = /\/+$/;

function trimUrl(value: string): string {
  return value.trim().replace(ISSUER_TRAILING_SLASH, "");
}

function validUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Reads the OIDC configuration. Returns null when identity is not configured,
 * which makes the whole console fail closed (same contract as before).
 */
export function readOidcConfig(req?: Request): OidcConfig | null {
  const issuer = trimUrl(process.env.CRM_A_OIDC_ISSUER ?? "");
  const internalIssuer = trimUrl(process.env.CRM_A_OIDC_INTERNAL_ISSUER ?? "") || issuer;
  const clientId = process.env.CRM_A_OIDC_CLIENT_ID?.trim() ?? "";
  const clientSecret = process.env.CRM_A_OIDC_CLIENT_SECRET?.trim() ?? "";

  if (!validUrl(issuer) || !validUrl(internalIssuer)) {return null;}
  if (!clientId || clientSecret.length < 8) {return null;}

  const redirectUri =
    process.env.CRM_A_OIDC_REDIRECT_URI?.trim() ||
    (req ? new URL("/api/auth/callback", req.url).toString() : "");
  const postLogoutRedirectUri =
    process.env.CRM_A_OIDC_POST_LOGOUT_REDIRECT_URI?.trim() ||
    (req ? new URL("/login", req.url).toString() : "");

  if (!validUrl(redirectUri) || !validUrl(postLogoutRedirectUri)) {return null;}

  return {
    issuer,
    internalIssuer,
    clientId,
    clientSecret,
    redirectUri,
    postLogoutRedirectUri,
    scopes: process.env.CRM_A_OIDC_SCOPES?.trim() || "openid profile email",
  };
}

export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function createRandomToken(bytes = 24): string {
  return randomBytes(bytes).toString("base64url");
}

export function buildAuthorizeUrl(
  config: OidcConfig,
  params: { state: string; nonce: string; codeChallenge: string },
): string {
  const url = new URL(`${config.issuer}/protocol/openid-connect/auth`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("scope", config.scopes);
  url.searchParams.set("state", params.state);
  url.searchParams.set("nonce", params.nonce);
  url.searchParams.set("code_challenge", params.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export function buildLogoutUrl(config: OidcConfig, idTokenHint?: string): string {
  const url = new URL(`${config.issuer}/protocol/openid-connect/logout`);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("post_logout_redirect_uri", config.postLogoutRedirectUri);
  if (idTokenHint) {url.searchParams.set("id_token_hint", idTokenHint);}
  return url.toString();
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Exchanges the authorization code. Server-to-server, client_secret_post. */
export async function exchangeCode(
  config: OidcConfig,
  params: { code: string; codeVerifier: string; redirectUri?: string; fetchImpl?: FetchLike },
): Promise<OidcTokens | null> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: params.code,
    redirect_uri: params.redirectUri || config.redirectUri,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code_verifier: params.codeVerifier,
  });
  const fetchImpl = params.fetchImpl ?? fetch;
  try {
    const res = await fetchImpl(`${config.internalIssuer}/protocol/openid-connect/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      cache: "no-store",
    });
    if (!res.ok) {return null;}
    const json = (await res.json()) as {
      access_token?: unknown;
      id_token?: unknown;
      refresh_token?: unknown;
      expires_in?: unknown;
    };
    if (typeof json.access_token !== "string" || typeof json.id_token !== "string") {
      return null;
    }
    return {
      accessToken: json.access_token,
      idToken: json.id_token,
      refreshToken: typeof json.refresh_token === "string" ? json.refresh_token : undefined,
      expiresIn: typeof json.expires_in === "number" ? json.expires_in : undefined,
    };
  } catch {
    return null;
  }
}

function decodeSegment<T>(segment: string): T | null {
  try {
    return JSON.parse(Buffer.from(segment, "base64url").toString("utf-8")) as T;
  } catch {
    return null;
  }
}

export function decodeJwt(token: string): { header: Record<string, unknown>; claims: IdTokenClaims } | null {
  const [rawHeader, rawClaims] = token.split(".");
  if (!rawHeader || !rawClaims) {return null;}
  const header = decodeSegment<Record<string, unknown>>(rawHeader);
  const claims = decodeSegment<IdTokenClaims>(rawClaims);
  if (!header || !claims) {return null;}
  return { header, claims };
}

const jwksCache = new Map<string, { keys: Jwk[]; fetchedAt: number }>();
const JWKS_TTL_MS = 5 * 60 * 1000;

export async function fetchJwks(
  config: OidcConfig,
  fetchImpl: FetchLike = fetch,
  nowMs = Date.now(),
): Promise<Jwk[]> {
  const cached = jwksCache.get(config.internalIssuer);
  if (cached && nowMs - cached.fetchedAt < JWKS_TTL_MS) {return cached.keys;}
  const res = await fetchImpl(`${config.internalIssuer}/protocol/openid-connect/certs`, {
    cache: "no-store",
  });
  if (!res.ok) {return [];}
  const body = (await res.json()) as { keys?: unknown };
  if (!Array.isArray(body.keys)) {return [];}
  const keys = body.keys.filter(
    (key): key is Jwk =>
      typeof key === "object" && key !== null && typeof (key as Jwk).n === "string",
  );
  jwksCache.set(config.internalIssuer, { keys, fetchedAt: nowMs });
  return keys;
}

export function clearJwksCache(): void {
  jwksCache.clear();
}

/** Verifies an RS256 JWT signature against a JWKS key set. */
export function verifySignature(
  token: string,
  keys: readonly Jwk[],
): { header: Record<string, unknown>; claims: IdTokenClaims } | null {
  const parts = token.split(".");
  if (parts.length !== 3) {return null;}
  const [rawHeader, rawClaims, rawSignature] = parts as [string, string, string];
  const header = decodeSegment<Record<string, unknown>>(rawHeader);
  const claims = decodeSegment<IdTokenClaims>(rawClaims);
  if (!header || !claims) {return null;}
  if (header.alg !== "RS256") {return null;}

  const candidates = keys.filter(
    (key) => !header.kid || !key.kid || key.kid === header.kid,
  );
  for (const jwk of candidates) {
    try {
      const publicKey = createPublicKey({ key: jwk, format: "jwk" });
      const ok = cryptoVerify(
        "RSA-SHA256",
        Buffer.from(`${rawHeader}.${rawClaims}`),
        publicKey,
        Buffer.from(rawSignature, "base64url"),
      );
      if (ok) {return { header, claims };}
    } catch {
      // Wrong key type/shape: try the next one.
    }
  }
  return null;
}

export type VerifyOptions = {
  issuer: string;
  clientId: string;
  nonce?: string;
  nowMs?: number;
  /** Clock tolerance in seconds. */
  toleranceSeconds?: number;
};

/** Full ID-token validation: signature + iss + aud/azp + exp + nonce. */
export function verifyIdToken(
  idToken: string,
  keys: readonly Jwk[],
  options: VerifyOptions,
): IdTokenClaims | null {
  const verified = verifySignature(idToken, keys);
  if (!verified) {return null;}
  const { header, claims } = verified;
  const now = Math.floor((options.nowMs ?? Date.now()) / 1000);
  const tolerance = options.toleranceSeconds ?? 60;

  if (header.typ && header.typ !== "JWT" && header.typ !== "id_token") {return null;}
  if (claims.iss !== options.issuer) {return null;}
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audience.includes(options.clientId)) {return null;}
  if (claims.azp && claims.azp !== options.clientId) {return null;}
  if (typeof claims.exp !== "number" || claims.exp + tolerance <= now) {return null;}
  if (options.nonce !== undefined && claims.nonce !== options.nonce) {return null;}
  return claims;
}

/**
 * Access-token check used only as a fallback to read realm roles when the ID
 * token does not carry them. Audience is `account`, so we check `azp`.
 */
export function verifyAccessToken(
  accessToken: string,
  keys: readonly Jwk[],
  options: VerifyOptions,
): IdTokenClaims | null {
  const verified = verifySignature(accessToken, keys);
  if (!verified) {return null;}
  const { claims } = verified;
  const now = Math.floor((options.nowMs ?? Date.now()) / 1000);
  const tolerance = options.toleranceSeconds ?? 60;
  if (claims.iss !== options.issuer) {return null;}
  if (claims.azp !== options.clientId) {return null;}
  if (typeof claims.exp !== "number" || claims.exp + tolerance <= now) {return null;}
  return claims;
}

/** Intersects the token roles with the local matrix, preserving order. */
export function rolesFromClaims(claims: IdTokenClaims): OperatorRole[] {
  const raw = claims.realm_access?.roles;
  if (!Array.isArray(raw)) {return [];}
  const seen = new Set<OperatorRole>();
  for (const value of raw) {
    if (typeof value === "string" && isRole(value)) {seen.add(value);}
  }
  return [...seen];
}

export function displayNameFromClaims(claims: IdTokenClaims): string {
  return (
    claims.preferred_username ||
    claims.email ||
    claims.name ||
    claims.sub ||
    "operatore"
  );
}
