import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "../../middleware";
import { SESSION_COOKIE, signSessionToken } from "../../lib/security/session";

const SECRET = "test-session-secret-value-1234";
const original = process.env.CRM_A_SESSION_SECRET;

beforeEach(() => {
  process.env.CRM_A_SESSION_SECRET = SECRET;
});

afterEach(() => {
  if (original === undefined) {delete process.env.CRM_A_SESSION_SECRET;}
  else {process.env.CRM_A_SESSION_SECRET = original;}
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
    expect(res.headers.get("location")).toContain("/login");
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
