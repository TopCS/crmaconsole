import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  checkOperatorPassword,
  readOperatorPassword,
  readSessionFromRequest,
  requireOperator,
  SESSION_COOKIE,
  signSessionToken,
  verifySessionToken,
} from "./session";

const ENV_KEYS = ["CRM_A_SESSION_SECRET", "CRM_A_OPERATOR_PASSWORD"] as const;
const original: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {original[key] = process.env[key];}
  process.env.CRM_A_SESSION_SECRET = "test-session-secret-value-1234";
  process.env.CRM_A_OPERATOR_PASSWORD = "operator-password-123";
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
  it("signs and verifies a token", () => {
    const token = signSessionToken();
    expect(token).toBeTruthy();
    const principal = verifySessionToken(token);
    expect(principal?.sub).toBe("operator");
  });

  it("rejects a tampered payload", () => {
    const token = signSessionToken() as string;
    const [body, sig] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({ sub: "operator", iat: 1, exp: 9_999_999_999 }),
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
    const token = signSessionToken(past);
    expect(token).toBeTruthy();
    expect(verifySessionToken(token)).toBeNull();
  });

  it("fails closed when the secret is missing", () => {
    delete process.env.CRM_A_SESSION_SECRET;
    expect(signSessionToken()).toBeNull();
    expect(verifySessionToken("anything.here")).toBeNull();
  });

  it("rejects a weak secret", () => {
    process.env.CRM_A_SESSION_SECRET = "short";
    expect(signSessionToken()).toBeNull();
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
    const token = signSessionToken() as string;
    const auth = requireOperator(requestWithCookie(token));
    expect(auth.ok).toBe(true);
  });

  it("reads the principal from the request cookie", () => {
    const token = signSessionToken() as string;
    expect(readSessionFromRequest(requestWithCookie(token))?.sub).toBe("operator");
  });
});

describe("operator password", () => {
  it("accepts the configured password only", () => {
    expect(checkOperatorPassword("operator-password-123")).toBe(true);
    expect(checkOperatorPassword("wrong-password")).toBe(false);
    expect(checkOperatorPassword("")).toBe(false);
  });

  it("disables login when the password is unset or too short", () => {
    delete process.env.CRM_A_OPERATOR_PASSWORD;
    expect(readOperatorPassword()).toBeNull();
    expect(checkOperatorPassword("anything")).toBe(false);
    process.env.CRM_A_OPERATOR_PASSWORD = "short";
    expect(readOperatorPassword()).toBeNull();
  });
});
