import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "../../middleware";
import { SESSION_COOKIE, signSessionToken } from "../../lib/security/session";

const SECRET = "test-session-secret-value-1234";
const original = process.env.CRM_A_SESSION_SECRET;
const originalPublicUrl = process.env.CRM_A_PUBLIC_URL;

beforeEach(() => {
  process.env.CRM_A_SESSION_SECRET = SECRET;
});

afterEach(() => {
  if (original === undefined) {delete process.env.CRM_A_SESSION_SECRET;}
  else {process.env.CRM_A_SESSION_SECRET = original;}
  if (originalPublicUrl === undefined) {delete process.env.CRM_A_PUBLIC_URL;}
  else {process.env.CRM_A_PUBLIC_URL = originalPublicUrl;}
});

function req(pathname: string, token?: string): NextRequest {
  const headers = new Headers();
  if (token) {headers.set("cookie", `${SESSION_COOKIE}=${encodeURIComponent(token)}`);}
  return new NextRequest(`http://localhost${pathname}`, { headers });
}

describe("middleware default-deny", () => {
  it("401s an anonymous API call", async () => {
    const res = await middleware(req("/api/crm/people"));
    expect(res.status).toBe(401);
  });

  it("redirects an anonymous page to /login", async () => {
    const res = await middleware(req("/workspace"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost/login?next=%2Fworkspace");
    expect(res.headers.get("location")).not.toContain("0.0.0.0");
  });

  it("uses the configured public origin behind a proxy that downgrades the scheme", async () => {
    process.env.CRM_A_PUBLIC_URL = "https://crma.warp.topcs.io";
    const headers = new Headers();
    headers.set("host", "crma.warp.topcs.io");
    headers.set("x-forwarded-host", "crma.warp.topcs.io");
    const proxied = new NextRequest("http://crm-a-console:3100/workspace", { headers });
    const res = await middleware(proxied);
    expect(res.headers.get("location")).toBe("https://crma.warp.topcs.io/login?next=%2Fworkspace");
  });

  it("allows a valid session", async () => {
    const token = signSessionToken("maria.rossi", ["communication"]) as string;
    const res = await middleware(req("/api/crm/people", token));
    // NextResponse.next() has no status set (200 by convention) and no location.
    expect(res.headers.get("location")).toBeNull();
    expect(res.status).toBe(200);
  });

  it("rejects a tampered session", async () => {
    const token = signSessionToken("maria.rossi", ["communication"]) as string;
    const tampered = `x${token.slice(1)}`;
    const res = await middleware(req("/api/crm/people", tampered));
    expect(res.status).toBe(401);
  });

  it("allows the public allowlist without a session", async () => {
    for (const path of ["/login", "/api/auth/login", "/api/events/collect", "/api/webhooks/phone"]) {
      const res = await middleware(req(path));
      expect(res.status).not.toBe(401);
    }
  });

  it("fails closed when the secret is missing", async () => {
    delete process.env.CRM_A_SESSION_SECRET;
    const res = await middleware(req("/api/crm/people"));
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toContain("CRM_A_SESSION_SECRET");
  });
});
