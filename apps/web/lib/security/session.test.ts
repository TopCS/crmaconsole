import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  readSessionFromRequest,
  requireOperator,
  SESSION_COOKIE,
  signSessionToken,
  verifySessionToken,
} from "./session";

const ENV_KEYS = ["CRM_A_SESSION_SECRET"] as const;
const original: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {original[key] = process.env[key];}
  process.env.CRM_A_SESSION_SECRET = "test-session-secret-value-1234";
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (original[key] === undefined) {delete process.env[key];}
    else {process.env[key] = original[key];}
  }
});

function requestWithCookie(token: string): Request {
  return new Request("http://localhost/api/crm/people", {
    headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}` },
  });
}

describe("session token", () => {
  it("signs and verifies a token carrying identity and roles", () => {
    const token = signSessionToken("maria.rossi", ["communication"]);
    expect(token).toBeTruthy();
    const principal = verifySessionToken(token);
    expect(principal?.sub).toBe("operator");
    expect(principal?.username).toBe("maria.rossi");
    expect(principal?.roles).toEqual(["communication"]);
  });

  it("rejects a tampered payload", () => {
    const token = signSessionToken("maria.rossi", ["communication"]) as string;
    const [body, sig] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({
        sub: "operator",
        username: "maria.rossi",
        roles: ["admin"],
        iat: 1,
        exp: 9_999_999_999,
      }),
      "utf-8",
    )
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(forged).not.toBe(body);
    expect(verifySessionToken(`${forged}.${sig}`)).toBeNull();
  });

  it("rejects an expired token", () => {
    const past = Date.now() - 1000 * 60 * 60 * 24;
    const token = signSessionToken("maria.rossi", ["communication"], past);
    expect(token).toBeTruthy();
    expect(verifySessionToken(token)).toBeNull();
  });

  it("fails closed when the secret is missing", () => {
    delete process.env.CRM_A_SESSION_SECRET;
    expect(signSessionToken("maria.rossi", ["communication"])).toBeNull();
    expect(verifySessionToken("anything.here")).toBeNull();
  });

  it("rejects a weak secret", () => {
    process.env.CRM_A_SESSION_SECRET = "short";
    expect(signSessionToken("maria.rossi", ["communication"])).toBeNull();
  });
});

describe("requireOperator", () => {
  it("401s without a cookie", () => {
    const auth = requireOperator(new Request("http://localhost/api/crm/people"));
    expect(auth.ok).toBe(false);
    if (!auth.ok) {expect(auth.response.status).toBe(401);}
  });

  it("401s with a forged cookie", () => {
    const auth = requireOperator(requestWithCookie("forged.signature"));
    expect(auth.ok).toBe(false);
  });

  it("accepts a valid session", () => {
    const token = signSessionToken("maria.rossi", ["communication"]) as string;
    const auth = requireOperator(requestWithCookie(token));
    expect(auth.ok).toBe(true);
  });

  it("reads the principal from the request cookie", () => {
    const token = signSessionToken("maria.rossi", ["communication"]) as string;
    const principal = readSessionFromRequest(requestWithCookie(token));
    expect(principal?.sub).toBe("operator");
    expect(principal?.username).toBe("maria.rossi");
  });
});
