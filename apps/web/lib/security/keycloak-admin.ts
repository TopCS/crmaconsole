/**
 * Keycloak Admin REST client (server-side only).
 *
 * Used by the console to manage identities *in Keycloak*, never in a local
 * file. Access is granted through a dedicated confidential client
 * (`crm-a-admin`) with a service account limited to the realm-management
 * roles `view-users`, `query-users`, `manage-users` and `view-realm`.
 *
 * The browser never sees the client secret: all calls go through the console
 * API, which is itself gated by `maxxi.operators.manage` (admin only).
 */

import { isRole, type OperatorRole } from "./rbac";
import type { FetchLike } from "./oidc";

export type KeycloakUser = {
  id: string;
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  enabled: boolean;
  roles: OperatorRole[];
};

export type AdminConfig = {
  /** e.g. http://keycloak:8080/realms/crm-a */
  issuer: string;
  /** e.g. http://keycloak:8080/admin/realms/crm-a */
  adminBase: string;
  realm: string;
  clientId: string;
  clientSecret: string;
};

type TokenCache = { token: string; expiresAt: number };

const tokenCache = new Map<string, TokenCache>();

export function readAdminConfig(): AdminConfig | null {
  const issuer = (process.env.CRM_A_OIDC_INTERNAL_ISSUER || process.env.CRM_A_OIDC_ISSUER || "")
    .trim()
    .replace(/\/+$/, "");
  const clientId = process.env.CRM_A_KEYCLOAK_ADMIN_CLIENT_ID?.trim() || "crm-a-admin";
  const clientSecret = process.env.CRM_A_KEYCLOAK_ADMIN_CLIENT_SECRET?.trim() ?? "";
  if (!issuer || clientSecret.length < 8) {return null;}

  let url: URL;
  try {
    url = new URL(issuer);
  } catch {
    return null;
  }
  const parts = url.pathname.split("/").filter(Boolean);
  const realmIndex = parts.lastIndexOf("realms");
  const realm = realmIndex >= 0 ? parts[realmIndex + 1] : "";
  if (!realm) {return null;}

  return {
    issuer,
    adminBase: `${url.origin}/admin/realms/${realm}`,
    realm,
    clientId,
    clientSecret,
  };
}

export function clearAdminTokenCache(): void {
  tokenCache.clear();
}

async function serviceToken(
  config: AdminConfig,
  fetchImpl: FetchLike,
  nowMs = Date.now(),
): Promise<string | null> {
  const cached = tokenCache.get(config.issuer);
  if (cached && cached.expiresAt > nowMs + 5000) {return cached.token;}

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: config.clientId,
    client_secret: config.clientSecret,
  });
  try {
    const res = await fetchImpl(`${config.issuer}/protocol/openid-connect/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      cache: "no-store",
    });
    if (!res.ok) {return null;}
    const json = (await res.json()) as { access_token?: unknown; expires_in?: unknown };
    if (typeof json.access_token !== "string") {return null;}
    const ttl = typeof json.expires_in === "number" ? json.expires_in : 60;
    tokenCache.set(config.issuer, {
      token: json.access_token,
      expiresAt: nowMs + ttl * 1000,
    });
    return json.access_token;
  } catch {
    return null;
  }
}

async function adminFetch(
  config: AdminConfig,
  path: string,
  init: RequestInit,
  fetchImpl: FetchLike,
): Promise<Response | null> {
  const token = await serviceToken(config, fetchImpl);
  if (!token) {return null;}
  try {
    return await fetchImpl(`${config.adminBase}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        ...(init.headers as Record<string, string> | undefined),
      },
      cache: "no-store",
    });
  } catch {
    return null;
  }
}

type RawRole = { id?: unknown; name?: unknown };

function rolesFromRoleList(rows: unknown): OperatorRole[] {
  if (!Array.isArray(rows)) {return [];}
  const found = new Set<OperatorRole>();
  for (const row of rows) {
    const name = typeof (row as RawRole)?.name === "string" ? (row as RawRole).name : "";
    if (isRole(name as string)) {found.add(name as OperatorRole);}
  }
  return [...found];
}

type RawUser = {
  id?: unknown;
  username?: unknown;
  email?: unknown;
  firstName?: unknown;
  lastName?: unknown;
  enabled?: unknown;
};

function toUser(raw: RawUser, roles: OperatorRole[]): KeycloakUser | null {
  if (typeof raw.id !== "string" || typeof raw.username !== "string") {return null;}
  return {
    id: raw.id,
    username: raw.username,
    email: typeof raw.email === "string" ? raw.email : "",
    firstName: typeof raw.firstName === "string" ? raw.firstName : "",
    lastName: typeof raw.lastName === "string" ? raw.lastName : "",
    enabled: raw.enabled !== false,
    roles,
  };
}

/** Lists users and their CRM-A roles. */
export async function listUsers(fetchImpl: FetchLike = fetch): Promise<KeycloakUser[] | null> {
  const config = readAdminConfig();
  if (!config) {return null;}
  const res = await adminFetch(
    config,
    `/users?max=200&briefRepresentation=false`,
    { method: "GET" },
    fetchImpl,
  );
  if (!res || !res.ok) {return null;}
  const raw = (await res.json()) as unknown;
  if (!Array.isArray(raw)) {return null;}

  const users: KeycloakUser[] = [];
  for (const row of raw as RawUser[]) {
    if (typeof row.id !== "string") {continue;}
    const rolesRes = await adminFetch(
      config,
      `/users/${encodeURIComponent(row.id)}/role-mappings/realm`,
      { method: "GET" },
      fetchImpl,
    );
    const roles = rolesRes && rolesRes.ok ? rolesFromRoleList(await rolesRes.json()) : [];
    const user = toUser(row, roles);
    if (user) {users.push(user);}
  }
  return users.toSorted((a, b) => a.username.localeCompare(b.username));
}

async function roleRepresentations(
  config: AdminConfig,
  roles: readonly OperatorRole[],
  fetchImpl: FetchLike,
): Promise<Array<{ id: string; name: string }> | null> {
  const out: Array<{ id: string; name: string }> = [];
  for (const role of roles) {
    const res = await adminFetch(
      config,
      `/roles/${encodeURIComponent(role)}`,
      { method: "GET" },
      fetchImpl,
    );
    if (!res || !res.ok) {return null;}
    const body = (await res.json()) as { id?: unknown; name?: unknown };
    if (typeof body.id !== "string" || typeof body.name !== "string") {return null;}
    out.push({ id: body.id, name: body.name });
  }
  return out;
}

export type UserInput = {
  username: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  password?: string;
  roles: OperatorRole[];
  enabled: boolean;
};

export type AdminResult = { ok: true; id: string } | { ok: false; reason: string };

const USERNAME_RE = /^[a-z0-9._-]{3,32}$/;

export function validateUserInput(input: Partial<UserInput>, requirePassword: boolean): string | null {
  if (!input.username || !USERNAME_RE.test(input.username)) {
    return "Username non valido: 3-32 caratteri tra a-z, 0-9, punto, trattino e underscore.";
  }
  if (!input.roles || input.roles.length === 0) {
    return "Assegna almeno un ruolo.";
  }
  if (requirePassword && (!input.password || input.password.length < 8)) {
    return "La password deve avere almeno 8 caratteri.";
  }
  if (input.password !== undefined && input.password.length > 0 && input.password.length < 8) {
    return "La password deve avere almeno 8 caratteri.";
  }
  if (input.email && !/^[^\s@]+@[^\s@]+$/.test(input.email)) {
    return "Email non valida.";
  }
  return null;
}

export async function createUser(
  input: UserInput,
  fetchImpl: FetchLike = fetch,
): Promise<AdminResult> {
  const config = readAdminConfig();
  if (!config) {return { ok: false, reason: "Keycloak admin client non configurato." };}
  const invalid = validateUserInput(input, true);
  if (invalid) {return { ok: false, reason: invalid };}

  const res = await adminFetch(
    config,
    "/users",
    {
      method: "POST",
      body: JSON.stringify({
        username: input.username,
        email: input.email || undefined,
        // Keycloak's default user profile requires both names; without them
        // the first login is forced into VERIFY_PROFILE. Use explicit values
        // when provided, otherwise a neutral default derived from the username.
        firstName: input.firstName || input.username,
        lastName: input.lastName || "Utente",
        enabled: input.enabled,
        emailVerified: true,
        requiredActions: [],
        credentials: input.password
          ? [{ type: "password", value: input.password, temporary: false }]
          : undefined,
      }),
    },
    fetchImpl,
  );
  if (!res || !res.ok) {
    return { ok: false, reason: res?.status === 409 ? "Username già esistente." : "Creazione utente fallita." };
  }

  const location = res.headers.get("location") ?? "";
  const id = location.split("/").filter(Boolean).pop() ?? "";
  if (!id) {return { ok: false, reason: "Keycloak non ha restituito l'id utente." };}

  const assigned = await setRoles(config, id, input.roles, fetchImpl);
  if (!assigned.ok) {return assigned;}
  return { ok: true, id };
}

async function setRoles(
  config: AdminConfig,
  userId: string,
  roles: readonly OperatorRole[],
  fetchImpl: FetchLike,
): Promise<AdminResult> {
  const wanted = await roleRepresentations(config, roles, fetchImpl);
  if (!wanted) {return { ok: false, reason: "Ruoli non disponibili nel realm." };}

  const currentRes = await adminFetch(
    config,
    `/users/${encodeURIComponent(userId)}/role-mappings/realm`,
    { method: "GET" },
    fetchImpl,
  );
  const current = currentRes && currentRes.ok ? await currentRes.json() : [];
  const currentCrm = Array.isArray(current)
    ? (current as RawRole[]).filter(
        (role): role is { id: string; name: string } =>
          typeof role.id === "string" &&
          typeof role.name === "string" &&
          isRole(role.name),
      )
    : [];

  const wantedNames = new Set(wanted.map((role) => role.name));
  const toRemove = currentCrm.filter((role) => !wantedNames.has(role.name));

  if (toRemove.length > 0) {
    const res = await adminFetch(
      config,
      `/users/${encodeURIComponent(userId)}/role-mappings/realm`,
      { method: "DELETE", body: JSON.stringify(toRemove) },
      fetchImpl,
    );
    if (!res || !res.ok) {return { ok: false, reason: "Rimozione ruoli fallita." };}
  }

  const currentNames = new Set(currentCrm.map((role) => role.name));
  const toAdd = wanted.filter((role) => !currentNames.has(role.name));
  if (toAdd.length > 0) {
    const res = await adminFetch(
      config,
      `/users/${encodeURIComponent(userId)}/role-mappings/realm`,
      { method: "POST", body: JSON.stringify(toAdd) },
      fetchImpl,
    );
    if (!res || !res.ok) {return { ok: false, reason: "Assegnazione ruoli fallita." };}
  }
  return { ok: true, id: userId };
}

export type UserPatch = {
  email?: string;
  firstName?: string;
  lastName?: string;
  password?: string;
  roles?: OperatorRole[];
  enabled?: boolean;
};

export async function updateUser(
  userId: string,
  patch: UserPatch,
  fetchImpl: FetchLike = fetch,
): Promise<AdminResult> {
  const config = readAdminConfig();
  if (!config) {return { ok: false, reason: "Keycloak admin client non configurato." };}
  if (!userId) {return { ok: false, reason: "id utente mancante." };}
  if (patch.password !== undefined && patch.password.length > 0 && patch.password.length < 8) {
    return { ok: false, reason: "La password deve avere almeno 8 caratteri." };
  }
  if (patch.roles !== undefined && patch.roles.length === 0) {
    return { ok: false, reason: "Assegna almeno un ruolo." };
  }

  const body: Record<string, unknown> = {};
  if (patch.email !== undefined) {body.email = patch.email || undefined;}
  if (patch.firstName !== undefined) {body.firstName = patch.firstName || undefined;}
  if (patch.lastName !== undefined) {body.lastName = patch.lastName || undefined;}
  if (patch.enabled !== undefined) {body.enabled = patch.enabled;}

  if (Object.keys(body).length > 0) {
    const res = await adminFetch(
      config,
      `/users/${encodeURIComponent(userId)}`,
      { method: "PUT", body: JSON.stringify(body) },
      fetchImpl,
    );
    if (!res || !res.ok) {return { ok: false, reason: "Aggiornamento utente fallito." };}
  }

  if (patch.password) {
    const res = await adminFetch(
      config,
      `/users/${encodeURIComponent(userId)}/reset-password`,
      {
        method: "PUT",
        body: JSON.stringify({ type: "password", value: patch.password, temporary: false }),
      },
      fetchImpl,
    );
    if (!res || !res.ok) {return { ok: false, reason: "Reset password fallito." };}
  }

  if (patch.roles) {
    return setRoles(config, userId, patch.roles, fetchImpl);
  }
  return { ok: true, id: userId };
}

export async function deleteUser(
  userId: string,
  fetchImpl: FetchLike = fetch,
): Promise<AdminResult> {
  const config = readAdminConfig();
  if (!config) {return { ok: false, reason: "Keycloak admin client non configurato." };}
  const res = await adminFetch(
    config,
    `/users/${encodeURIComponent(userId)}`,
    { method: "DELETE" },
    fetchImpl,
  );
  if (!res || (!res.ok && res.status !== 204)) {
    return { ok: false, reason: "Eliminazione utente fallita." };
  }
  return { ok: true, id: userId };
}
