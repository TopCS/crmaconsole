import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearAdminTokenCache,
  createUser,
  deleteUser,
  listUsers,
  readAdminConfig,
  updateUser,
  validateUserInput,
  type AdminConfig,
} from "./keycloak-admin";
import type { FetchLike } from "./oidc";

const ENV_KEYS = [
  "CRM_A_OIDC_ISSUER",
  "CRM_A_OIDC_INTERNAL_ISSUER",
  "CRM_A_KEYCLOAK_ADMIN_CLIENT_ID",
  "CRM_A_KEYCLOAK_ADMIN_CLIENT_SECRET",
] as const;
const original: Record<string, string | undefined> = {};

const BASE = "http://keycloak:8080";

beforeEach(() => {
  for (const key of ENV_KEYS) {original[key] = process.env[key];}
  process.env.CRM_A_OIDC_ISSUER = "http://localhost:8080/realms/crm-a";
  process.env.CRM_A_OIDC_INTERNAL_ISSUER = `${BASE}/realms/crm-a`;
  process.env.CRM_A_KEYCLOAK_ADMIN_CLIENT_ID = "crm-a-admin";
  process.env.CRM_A_KEYCLOAK_ADMIN_CLIENT_SECRET = "admin-client-secret";
  clearAdminTokenCache();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (original[key] === undefined) {delete process.env[key];}
    else {process.env[key] = original[key];}
  }
  clearAdminTokenCache();
});

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

type Call = { url: string; method: string; body: string };

/** Minimal in-memory Keycloak Admin API. */
function mockKeycloak(handlers: {
  users?: unknown;
  roles?: Record<string, unknown>;
  tokenStatus?: number;
  createStatus?: number;
  calls: Call[];
}): FetchLike {
  return async (input, init) => {
    const method = (init?.method ?? "GET").toUpperCase();
    const body = typeof init?.body === "string" ? init.body : "";
    handlers.calls.push({ url: input, method, body });

    if (input.endsWith("/protocol/openid-connect/token")) {
      if (handlers.tokenStatus && handlers.tokenStatus !== 200) {
        return json({ error: "unauthorized" }, handlers.tokenStatus);
      }
      return json({ access_token: "admin-access-token", expires_in: 60 });
    }
    if (input.endsWith("/protocol/openid-connect/certs")) {
      return json({ keys: [] });
    }
    if (input.includes("/users?") && method === "GET") {
      return json(handlers.users ?? []);
    }
    if (input.endsWith("/role-mappings/realm") && method === "GET") {
      return json([{ id: "r1", name: "communication" }]);
    }
    if (input.startsWith(`${BASE}/admin/realms/crm-a/roles/`) && method === "GET") {
      const role = decodeURIComponent(input.split("/").pop() ?? "");
      return json(handlers.roles?.[role] ?? { id: `role-${role}`, name: role });
    }
    if (input.endsWith("/users") && method === "POST") {
      const status = handlers.createStatus ?? 201;
      return new Response(null, {
        status,
        headers: { location: `${BASE}/admin/realms/crm-a/users/new-user-id` },
      });
    }
    if (input.endsWith("/role-mappings/realm") && (method === "POST" || method === "DELETE")) {
      return new Response(null, { status: 204 });
    }
    if (input.includes("/users/") && ["PUT", "DELETE"].includes(method)) {
      return new Response(null, { status: 204 });
    }
    return json({ error: `unexpected ${method} ${input}` }, 404);
  };
}

describe("Keycloak admin config", () => {
  it("derives the admin base URL from the internal issuer", () => {
    const config = readAdminConfig() as AdminConfig;
    expect(config.adminBase).toBe(`${BASE}/admin/realms/crm-a`);
    expect(config.realm).toBe("crm-a");
  });

  it("fails closed without a client secret", () => {
    delete process.env.CRM_A_KEYCLOAK_ADMIN_CLIENT_SECRET;
    expect(readAdminConfig()).toBeNull();
  });

  it("rejects an issuer without a realm", () => {
    process.env.CRM_A_OIDC_INTERNAL_ISSUER = "http://keycloak:8080";
    expect(readAdminConfig()).toBeNull();
  });
});

describe("user input validation", () => {
  it("accepts a well-formed user", () => {
    expect(
      validateUserInput(
        { username: "maria.rossi", password: "password-1234", roles: ["communication"] },
        true,
      ),
    ).toBeNull();
  });

  it("rejects bad usernames, empty roles and short passwords", () => {
    expect(validateUserInput({ username: "A B", password: "password-1234", roles: ["admin"] }, true)).toContain("Username");
    expect(validateUserInput({ username: "ok.user", password: "password-1234", roles: [] }, true)).toContain("ruolo");
    expect(validateUserInput({ username: "ok.user", password: "short", roles: ["admin"] }, true)).toContain("8 caratteri");
    expect(validateUserInput({ username: "ok.user", roles: ["admin"] }, true)).toContain("8 caratteri");
  });

  it("rejects a malformed email", () => {
    expect(
      validateUserInput(
        { username: "ok.user", password: "password-1234", roles: ["admin"], email: "not-an-email" },
        true,
      ),
    ).toContain("Email");
  });
});

describe("Keycloak admin client", () => {
  it("lists users and keeps only CRM-A roles", async () => {
    const calls: Call[] = [];
    const users = await listUsers(
      mockKeycloak({
        calls,
        users: [
          { id: "u1", username: "comm.demo", email: "c@example.invalid", enabled: true },
          { id: "u2", username: "info.demo", enabled: false },
        ],
      }),
    );
    expect(users?.map((user) => user.username)).toEqual(["comm.demo", "info.demo"]);
    expect(users?.every((user) => user.roles.join(",") === "communication")).toBe(true);
    expect(users?.[1]?.enabled).toBe(false);
  });

  it("creates a user and assigns roles", async () => {
    const calls: Call[] = [];
    const result = await createUser(
      {
        username: "maria.rossi",
        email: "maria@example.invalid",
        password: "password-1234",
        roles: ["communication", "membership"],
        enabled: true,
      },
      mockKeycloak({ calls }),
    );
    expect(result).toEqual({ ok: true, id: "new-user-id" });
    const created = calls.find((call) => call.method === "POST" && call.url.endsWith("/users"));
    expect(created?.body).not.toContain("client_secret");
    expect(created?.body).toContain("password-1234");
    expect(calls.some((call) => call.method === "POST" && call.url.endsWith("/role-mappings/realm"))).toBe(true);
  });

  it("maps a duplicate username to a readable error", async () => {
    const calls: Call[] = [];
    const result = await createUser(
      { username: "maria.rossi", password: "password-1234", roles: ["admin"], enabled: true },
      mockKeycloak({ calls, createStatus: 409 }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {expect(result.reason).toContain("già esistente");}
  });

  it("rejects invalid input before calling Keycloak", async () => {
    const calls: Call[] = [];
    const result = await createUser(
      { username: "x", password: "short", roles: [], enabled: true },
      mockKeycloak({ calls }),
    );
    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("fails closed when the service account cannot authenticate", async () => {
    const calls: Call[] = [];
    expect(await listUsers(mockKeycloak({ calls, tokenStatus: 401 }))).toBeNull();
  });

  it("updates a user, rotating the password and reconciling roles", async () => {
    const calls: Call[] = [];
    const result = await updateUser(
      "u1",
      { enabled: false, password: "new-password-99", roles: ["membership"] },
      mockKeycloak({ calls }),
    );
    expect(result).toEqual({ ok: true, id: "u1" });
    expect(calls.some((call) => call.method === "PUT" && call.url.endsWith("/users/u1"))).toBe(true);
    expect(calls.some((call) => call.url.endsWith("/reset-password"))).toBe(true);
    // communication was removed, membership added
    const removal = calls.find((call) => call.method === "DELETE");
    expect(removal?.body).toContain("communication");
    const addition = calls.find(
      (call) => call.method === "POST" && call.url.endsWith("/role-mappings/realm"),
    );
    expect(addition?.body).toContain("membership");
  });

  it("rejects disabling all roles", async () => {
    const calls: Call[] = [];
    const result = await updateUser("u1", { roles: [] }, mockKeycloak({ calls }));
    expect(result.ok).toBe(false);
  });

  it("deletes a user", async () => {
    const calls: Call[] = [];
    expect(await deleteUser("u1", mockKeycloak({ calls }))).toEqual({ ok: true, id: "u1" });
    expect(calls.some((call) => call.method === "DELETE" && call.url.endsWith("/users/u1"))).toBe(true);
  });
});
