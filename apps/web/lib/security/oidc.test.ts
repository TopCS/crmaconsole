import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash, generateKeyPairSync, sign as cryptoSign } from "node:crypto";
import {
  buildAuthorizeUrl,
  buildLogoutUrl,
  createPkcePair,
  decodeJwt,
  readOidcConfig,
  rolesFromClaims,
  verifyAccessToken,
  verifyIdToken,
  type IdTokenClaims,
  type Jwk,
  type OidcConfig,
} from "./oidc";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "test-key", alg: "RS256", use: "sig" } as Jwk;

function b64url(value: string): string {
  return Buffer.from(value, "utf-8").toString("base64url");
}

function signJwt(claims: Record<string, unknown>, header: Record<string, unknown> = {}): string {
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "test-key", ...header }));
  const body = b64url(JSON.stringify(claims));
  const signature = cryptoSign("RSA-SHA256", Buffer.from(`${head}.${body}`), privateKey);
  return `${head}.${body}.${signature.toString("base64url")}`;
}

const ISS = "http://localhost:8080/realms/crm-a";
const CLIENT = "crm-a-console";

function claims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    iss: ISS,
    aud: CLIENT,
    azp: CLIENT,
    sub: "user-1",
    preferred_username: "comm.demo",
    exp: Math.floor(Date.now() / 1000) + 300,
    iat: Math.floor(Date.now() / 1000),
    nonce: "nonce-123",
    realm_access: { roles: ["communication", "offline_access", "uma_authorization"] },
    ...overrides,
  };
}

const ENV_KEYS = [
  "CRM_A_OIDC_ISSUER",
  "CRM_A_OIDC_INTERNAL_ISSUER",
  "CRM_A_OIDC_CLIENT_ID",
  "CRM_A_OIDC_CLIENT_SECRET",
  "CRM_A_OIDC_REDIRECT_URI",
  "CRM_A_OIDC_POST_LOGOUT_REDIRECT_URI",
  "CRM_A_OIDC_SCOPES",
] as const;

const original: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {original[key] = process.env[key];}
  process.env.CRM_A_OIDC_ISSUER = ISS;
  process.env.CRM_A_OIDC_INTERNAL_ISSUER = "http://keycloak:8080/realms/crm-a";
  process.env.CRM_A_OIDC_CLIENT_ID = CLIENT;
  process.env.CRM_A_OIDC_CLIENT_SECRET = "client-secret-value";
  process.env.CRM_A_OIDC_REDIRECT_URI = "http://localhost:3100/api/auth/callback";
  process.env.CRM_A_OIDC_POST_LOGOUT_REDIRECT_URI = "http://localhost:3100/login";
  delete process.env.CRM_A_OIDC_SCOPES;
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (original[key] === undefined) {delete process.env[key];}
    else {process.env[key] = original[key];}
  }
});

describe("OIDC config", () => {
  it("fails closed without issuer/client", () => {
    expect(readOidcConfig()).not.toBeNull();
    delete process.env.CRM_A_OIDC_CLIENT_SECRET;
    expect(readOidcConfig()).toBeNull();
    delete process.env.CRM_A_OIDC_ISSUER;
    expect(readOidcConfig()).toBeNull();
  });

  it("rejects a non-http issuer", () => {
    process.env.CRM_A_OIDC_ISSUER = "javascript:alert(1)";
    expect(readOidcConfig()).toBeNull();
  });

  it("falls back to the public issuer for server calls", () => {
    delete process.env.CRM_A_OIDC_INTERNAL_ISSUER;
    expect(readOidcConfig()?.internalIssuer).toBe(ISS);
  });
});

describe("PKCE + authorize URL", () => {
  it("derives a valid S256 challenge", () => {
    const { verifier, challenge } = createPkcePair();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(challenge).toBe(createHash("sha256").update(verifier).digest("base64url"));
  });

  it("builds the authorization request with PKCE and state", () => {
    const config = readOidcConfig() as OidcConfig;
    const url = new URL(
      buildAuthorizeUrl(config, {
        state: "state-1",
        nonce: "nonce-1",
        codeChallenge: "challenge-1",
      }),
    );
    expect(url.origin + url.pathname).toBe(`${ISS}/protocol/openid-connect/auth`);
    expect(url.searchParams.get("client_id")).toBe(CLIENT);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBe("challenge-1");
    expect(url.searchParams.get("state")).toBe("state-1");
    expect(url.searchParams.get("nonce")).toBe("nonce-1");
  });

  it("builds a logout URL with the post-logout redirect", () => {
    const config = readOidcConfig() as OidcConfig;
    const url = new URL(buildLogoutUrl(config, "id-token"));
    expect(url.pathname).toBe("/realms/crm-a/protocol/openid-connect/logout");
    expect(url.searchParams.get("id_token_hint")).toBe("id-token");
    expect(url.searchParams.get("post_logout_redirect_uri")).toBe(
      "http://localhost:3100/login",
    );
  });
});

describe("ID token verification", () => {
  const options = { issuer: ISS, clientId: CLIENT, nonce: "nonce-123" };

  it("accepts a correctly signed token", () => {
    const verified = verifyIdToken(signJwt(claims()), [jwk], options);
    expect(verified?.preferred_username).toBe("comm.demo");
  });

  it("rejects a tampered payload", () => {
    const token = signJwt(claims());
    const [head, , sig] = token.split(".");
    const forged = `${head}.${b64url(JSON.stringify(claims({ preferred_username: "admin.demo" })))}.${sig}`;
    expect(verifyIdToken(forged, [jwk], options)).toBeNull();
  });

  it("rejects a token signed by another key", () => {
    const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const head = b64url(JSON.stringify({ alg: "RS256", kid: "other" }));
    const body = b64url(JSON.stringify(claims()));
    const sig = cryptoSign("RSA-SHA256", Buffer.from(`${head}.${body}`), other.privateKey);
    expect(verifyIdToken(`${head}.${body}.${sig.toString("base64url")}`, [jwk], options)).toBeNull();
  });

  it("rejects wrong nonce, wrong issuer and wrong audience", () => {
    expect(
      verifyIdToken(signJwt(claims({ nonce: "other" })), [jwk], options),
    ).toBeNull();
    expect(
      verifyIdToken(signJwt(claims({ iss: "http://evil/realms/crm-a" })), [jwk], options),
    ).toBeNull();
    expect(
      verifyIdToken(signJwt(claims({ aud: "another-client", azp: "another-client" })), [jwk], options),
    ).toBeNull();
  });

  it("rejects an expired token", () => {
    const expired = Math.floor(Date.now() / 1000) - 3600;
    expect(
      verifyIdToken(signJwt(claims({ exp: expired })), [jwk], options),
    ).toBeNull();
  });

  it("rejects non-RS256 algorithms", () => {
    const token = signJwt(claims(), { alg: "none" });
    expect(verifyIdToken(token, [jwk], options)).toBeNull();
  });

  it("verifies access tokens only for the expected client", () => {
    const access = signJwt(claims({ aud: "account" }));
    expect(
      verifyAccessToken(access, [jwk], { issuer: ISS, clientId: CLIENT })?.azp,
    ).toBe(CLIENT);
    expect(
      verifyAccessToken(access, [jwk], { issuer: ISS, clientId: "other" }),
    ).toBeNull();
  });

  it("decodes header and claims without trusting them", () => {
    const decoded = decodeJwt(signJwt(claims()));
    expect(decoded?.header.alg).toBe("RS256");
    expect(decoded?.claims.sub).toBe("user-1");
  });
});

describe("role mapping", () => {
  it("keeps only roles in the local matrix", () => {
    expect(rolesFromClaims(claims() as IdTokenClaims)).toEqual(["communication"]);
  });

  it("deduplicates and ignores malformed claims", () => {
    expect(
      rolesFromClaims({
        realm_access: {
          roles: ["membership", "membership", "root", 42, null],
        },
      }),
    ).toEqual(["membership"]);
    expect(rolesFromClaims({})).toEqual([]);
  });
});
