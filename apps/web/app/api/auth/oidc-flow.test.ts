import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { safeNextPath as safeNext } from "@/lib/security/redirect";
import { GET as loginGet, POST as loginPost } from "./login/route";
import { GET as callbackGet } from "./callback/route";
import { GET as logoutGet, POST as logoutPost } from "./logout/route";
import { OIDC_STATE_COOKIE, SESSION_COOKIE } from "@/lib/security/session";

const ENV_KEYS = [
  "CRM_A_OIDC_ISSUER",
  "CRM_A_OIDC_INTERNAL_ISSUER",
  "CRM_A_OIDC_CLIENT_ID",
  "CRM_A_OIDC_CLIENT_SECRET",
  "CRM_A_OIDC_REDIRECT_URI",
  "CRM_A_OIDC_POST_LOGOUT_REDIRECT_URI",
] as const;
const original: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {original[key] = process.env[key];}
  process.env.CRM_A_OIDC_ISSUER = "http://localhost:8080/realms/crm-a";
  process.env.CRM_A_OIDC_INTERNAL_ISSUER = "http://localhost:8080/realms/crm-a";
  process.env.CRM_A_OIDC_CLIENT_ID = "crm-a-console";
  process.env.CRM_A_OIDC_CLIENT_SECRET = "client-secret-value";
  process.env.CRM_A_OIDC_REDIRECT_URI = "http://localhost:3100/api/auth/callback";
  process.env.CRM_A_OIDC_POST_LOGOUT_REDIRECT_URI = "http://localhost:3100/login";
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (original[key] === undefined) {delete process.env[key];}
    else {process.env[key] = original[key];}
  }
});

describe("GET /api/auth/login", () => {
  it("fails closed when Keycloak is not configured", async () => {
    delete process.env.CRM_A_OIDC_ISSUER;
    const res = await loginGet(new Request("http://localhost:3100/api/auth/login"));
    expect(res.status).toBe(503);
    expect(await res.text()).toContain("fail-closed");
  });

  it("redirects to Keycloak with PKCE and a state cookie", async () => {
    const res = await loginGet(
      new Request("http://localhost:3100/api/auth/login?next=%2Fmaxxi%2Fpeople"),
    );
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("location") ?? "");
    expect(location.searchParams.get("code_challenge_method")).toBe("S256");
    expect(location.searchParams.get("state")).toBeTruthy();
    expect(location.searchParams.get("nonce")).toBeTruthy();
    expect(location.searchParams.get("redirect_uri")).toBe(
      "http://localhost:3100/api/auth/callback",
    );

    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`${OIDC_STATE_COOKIE}=`);
    expect(cookie.toLowerCase()).toContain("httponly");
    expect(cookie.toLowerCase()).toContain("samesite=lax");
    expect(decodeURIComponent(cookie)).toContain('"next":"/maxxi/people"');
  });

  it("never stores the client secret in the state cookie", async () => {
    const res = await loginGet(new Request("http://localhost:3100/api/auth/login"));
    expect(decodeURIComponent(res.headers.get("set-cookie") ?? "")).not.toContain(
      "client-secret-value",
    );
  });

  it("does not accept passwords anymore", async () => {
    const res = await loginPost();
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET");
  });
});

describe("safeNext", () => {
  it("keeps same-origin relative paths", () => {
    expect(safeNext("/maxxi/people")).toBe("/maxxi/people");
    expect(safeNext("/maxxi?tab=1")).toBe("/maxxi?tab=1");
  });

  it("rejects open redirects", () => {
    for (const value of ["https://evil.example", "//evil.example", "/\\evil", "javascript:alert(1)"]) {
      expect(safeNext(value)).toBe("/maxxi");
    }
    expect(safeNext(null)).toBe("/maxxi");
  });
});

describe("GET /api/auth/callback", () => {
  it("rejects a callback without state", async () => {
    const res = await callbackGet(
      new Request("http://localhost:3100/api/auth/callback?code=abc"),
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login?error=state_missing");
    expect(res.headers.get("set-cookie") ?? "").toContain(`${OIDC_STATE_COOKIE}=`);
  });

  it("rejects a state that does not match the cookie", async () => {
    const state = encodeURIComponent(
      JSON.stringify({
        state: "expected",
        nonce: "n",
        verifier: "v",
        next: "/maxxi",
        createdAt: Date.now(),
      }),
    );
    const res = await callbackGet(
      new Request("http://localhost:3100/api/auth/callback?code=abc&state=other", {
        headers: { cookie: `${OIDC_STATE_COOKIE}=${state}` },
      }),
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login?error=state_mismatch");
  });

  it("rejects an expired state even when it matches", async () => {
    const state = encodeURIComponent(
      JSON.stringify({
        state: "same",
        nonce: "n",
        verifier: "v",
        next: "/maxxi",
        createdAt: Date.now() - 60 * 60 * 1000,
      }),
    );
    const res = await callbackGet(
      new Request("http://localhost:3100/api/auth/callback?code=abc&state=same", {
        headers: { cookie: `${OIDC_STATE_COOKIE}=${state}` },
      }),
    );
    expect(res.headers.get("location")).toBe("/login?error=state_expired");
  });

  it("forwards an IdP access_denied without issuing a session", async () => {
    const res = await callbackGet(
      new Request("http://localhost:3100/api/auth/callback?error=access_denied"),
    );
    expect(res.headers.get("location")).toBe("/login?error=access_denied");
    expect(res.headers.get("set-cookie") ?? "").not.toContain(`${SESSION_COOKIE}=`);
  });
});

describe("logout", () => {
  it("clears the session and points at the Keycloak logout endpoint", async () => {
    const res = await logoutPost(
      new Request("http://localhost:3100/api/auth/logout", {
        headers: { cookie: `${SESSION_COOKIE}=abc` },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { logoutUrl?: string };
    expect(body.logoutUrl).toContain("/protocol/openid-connect/logout");
    const cookies = res.headers.get("set-cookie") ?? "";
    expect(cookies).toContain(`${SESSION_COOKIE}=;`);
    expect(cookies).toContain("Max-Age=0");
  });

  it("still clears the session when Keycloak is not configured", async () => {
    delete process.env.CRM_A_OIDC_ISSUER;
    const res = await logoutGet(new Request("http://localhost:3100/api/auth/logout"));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login");
    expect(res.headers.get("set-cookie") ?? "").toContain("Max-Age=0");
  });
});
