/**
 * GET /api/auth/login — starts the Keycloak Authorization Code + PKCE flow.
 *
 * The console no longer accepts passwords: identity is delegated to Keycloak.
 * We only store a short-lived, httpOnly state cookie holding the CSRF state,
 * the OIDC nonce and the PKCE verifier; the callback validates all three.
 *
 * When Keycloak is not configured the endpoint fails closed with a 503.
 */

import {
  OIDC_STATE_COOKIE,
  OIDC_STATE_TTL_SECONDS,
  buildCookie,
} from "@/lib/security/session";
import {
  buildAuthorizeUrl,
  createPkcePair,
  createRandomToken,
  readOidcConfig,
} from "@/lib/security/oidc";
import { safeNextPath } from "@/lib/security/redirect";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function notConfigured(): Response {
  return new Response(
    `<!doctype html><html lang="it"><meta charset="utf-8"><title>Accesso non configurato</title>
<body style="font-family:system-ui;max-width:34rem;margin:12vh auto;padding:0 1.5rem;line-height:1.5">
<h1 style="font-size:1.2rem">Accesso non configurato</h1>
<p>Keycloak non è raggiungibile dalla console: mancano <code>CRM_A_OIDC_ISSUER</code>,
<code>CRM_A_OIDC_CLIENT_ID</code> o <code>CRM_A_OIDC_CLIENT_SECRET</code>.</p>
<p>La superficie resta chiusa (fail-closed). Avvia lo stack con
<code>docker compose up -d keycloak keycloak-db</code> e imposta le variabili OIDC.</p>
</body></html>`,
    { status: 503, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const config = readOidcConfig(req);
  if (!config) {return notConfigured();}

  const next = safeNextPath(url.searchParams.get("next"));
  const state = createRandomToken();
  const nonce = createRandomToken();
  const pkce = createPkcePair();

  const payload = JSON.stringify({
    state,
    nonce,
    verifier: pkce.verifier,
    next,
    createdAt: Date.now(),
  });

  const location = buildAuthorizeUrl(config, {
    state,
    nonce,
    codeChallenge: pkce.challenge,
  });

  return new Response(null, {
    status: 302,
    headers: {
      location,
      "cache-control": "no-store",
      "set-cookie": buildCookie(req, OIDC_STATE_COOKIE, payload, {
        maxAge: OIDC_STATE_TTL_SECONDS,
        path: "/api/auth",
      }),
    },
  });
}

export async function POST() {
  return Response.json(
    {
      error: "Password login is disabled: authentication is delegated to Keycloak.",
      hint: "Start the flow with GET /api/auth/login.",
    },
    { status: 405, headers: { allow: "GET" } },
  );
}
