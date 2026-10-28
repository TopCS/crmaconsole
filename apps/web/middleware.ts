/**
 * Default-deny gate for the whole web surface (SEC-01/SEC-06).
 *
 * Order of trust:
 *   1. Public ingestion/webhook routes are explicitly allowlisted and verify
 *      their own token/HMAC inside the handler.
 *   2. Everything else requires a valid signed operator session cookie.
 *
 * If CRM_A_SESSION_SECRET is missing the gate fails CLOSED: only allowlisted
 * routes stay reachable, so a misconfigured deploy cannot expose CRM data.
 */

import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "crm_a_session";

/**
 * Routes that intentionally accept unauthenticated traffic.
 *
 * Every entry here verifies its own credential (Bearer secret, shared token or
 * HMAC) inside the handler, and fails closed when the secret is not configured.
 * Keep this list narrow: anything not listed requires an operator session.
 */
const PUBLIC_PREFIXES = [
  "/api/auth/login",
  "/api/auth/callback",
  "/api/auth/logout",
  "/api/events/collect",
  "/api/events/identify",
  // Self-verified by isPhoneWebhookAuthorized / token query param.
  "/api/webhooks/",
  "/api/nlpearl/",
  "/api/campaigns/",
  "/api/demo/",
  "/api/marketing/brief",
  "/api/shopify/admin",
  // Self-verified by guardPermission → operator session or service Bearer.
  "/api/maxxi/",
];

const PUBLIC_EXACT = new Set<string>([
  "/login",
  "/favicon.ico",
  "/tracker.js",
  // Exact route only: subpaths are NOT service-authenticated.
  "/api/crm/segments",
]);

const PUBLIC_ASSET_PREFIXES = ["/_next/", "/images/", "/assets/"];

function isPublic(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) {return true;}
  if (PUBLIC_ASSET_PREFIXES.some((p) => pathname.startsWith(p))) {return true;}
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) {return true;}
  // Static files with an extension at the root (icons, manifests, fonts).
  if (!pathname.startsWith("/api/") && /\.[a-z0-9]{2,5}$/i.test(pathname)) {return true;}
  return false;
}

function b64urlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  const binary = atob(padded + pad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {bytes[i] = binary.charCodeAt(i);}
  return bytes;
}

function toB64url(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  let binary = "";
  for (const byte of view) {binary += String.fromCharCode(byte);}
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

type VerifiedSession = { roles: string[] } | null;

async function verifyToken(token: string, secret: string): Promise<VerifiedSession> {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) {return null;}
  const body = token.slice(0, dot);
  const provided = token.slice(dot + 1);
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
    if (toB64url(sig) !== provided) {return null;}
    const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(body))) as {
      sub?: string;
      exp?: number;
      roles?: unknown;
    };
    if (payload.sub !== "operator") {return null;}
    if (typeof payload.exp !== "number" || payload.exp * 1000 <= Date.now()) {return null;}
    const roles = Array.isArray(payload.roles)
      ? payload.roles.filter((role): role is string => typeof role === "string")
      : [];
    return { roles };
  } catch {
    return null;
  }
}

/** Page-level roles: the sidebar hides these links, this enforces the URL. */
const PAGE_ROLES: Array<{ prefix: string; roles: string[] }> = [
  { prefix: "/maxxi/operators", roles: ["admin"] },
];

function pageAllowed(pathname: string, roles: string[]): boolean {
  const rule = PAGE_ROLES.find((entry) => pathname === entry.prefix || pathname.startsWith(`${entry.prefix}/`));
  if (!rule) {return true;}
  return rule.roles.some((role) => roles.includes(role));
}

export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (isPublic(pathname)) {return NextResponse.next();}

  const secret = process.env.CRM_A_SESSION_SECRET?.trim() ?? "";
  const token = req.cookies.get(SESSION_COOKIE)?.value ?? "";
  const session = secret.length >= 16 && token ? await verifyToken(token, secret) : null;

  if (session) {
    // Signed-in but lacking the page role: send them back to the dashboard
    // instead of rendering a page whose data calls will all 403.
    if (!pageAllowed(pathname, session.roles)) {
      const deniedUrl = req.nextUrl.clone();
      deniedUrl.pathname = "/maxxi";
      deniedUrl.search = "";
      return NextResponse.redirect(deniedUrl);
    }
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      {
        error: secret.length >= 16
          ? "Unauthorized"
          : "Access gate not configured (CRM_A_SESSION_SECRET missing).",
      },
      { status: 401 },
    );
  }

  const loginUrl = req.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Skip Next internals and files; the function still re-checks defensively.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
