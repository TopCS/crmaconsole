/**
 * /api/maxxi/operators — admin-only identity management, backed by Keycloak.
 *
 * The console never stores accounts or passwords: it proxies the Keycloak
 * Admin REST API through a confidential service account. The local RBAC
 * matrix still decides who may call this endpoint.
 *
 * GET    → list users with their CRM-A roles.
 * POST   → create a user ({ username, email?, password, roles[], enabled? }).
 * PATCH  → update a user ({ id, email?, password?, roles?, enabled? }).
 * DELETE ?id= → remove a user (cannot remove or disable yourself).
 */

import { guardPermission, principalUsername } from "../_guard";
import {
  createUser,
  deleteUser,
  listUsers,
  readAdminConfig,
  updateUser,
  type UserPatch,
} from "@/lib/security/keycloak-admin";
import { isRole, type OperatorRole } from "@/lib/security/rbac";
import { recordAudit } from "@/lib/maxxi/queries";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function keycloakUnavailable(): Response {
  return Response.json(
    {
      error: "Keycloak admin client non configurato.",
      hint: "Imposta CRM_A_OIDC_ISSUER, CRM_A_KEYCLOAK_ADMIN_CLIENT_ID e CRM_A_KEYCLOAK_ADMIN_CLIENT_SECRET.",
    },
    { status: 503 },
  );
}

function parseRoles(raw: unknown): OperatorRole[] {
  if (!Array.isArray(raw)) {return [];}
  return raw.filter(
    (role): role is OperatorRole => typeof role === "string" && isRole(role),
  );
}

export async function GET(req: Request) {
  const auth = guardPermission(req, "maxxi.operators.manage");
  if (!auth.ok) {return auth.response;}
  if (!readAdminConfig()) {return keycloakUnavailable();}

  const users = await listUsers();
  if (!users) {
    return Response.json({ error: "Keycloak non raggiungibile." }, { status: 502 });
  }
  return Response.json({ ok: true, source: "keycloak", operators: users });
}

export async function POST(req: Request) {
  const auth = guardPermission(req, "maxxi.operators.manage");
  if (!auth.ok) {return auth.response;}
  if (!readAdminConfig()) {return keycloakUnavailable();}

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const roles = parseRoles(body.roles);
  const result = await createUser({
    username: typeof body.username === "string" ? body.username.trim().toLowerCase() : "",
    email: typeof body.email === "string" ? body.email.trim() : undefined,
    firstName: typeof body.firstName === "string" ? body.firstName.trim() : undefined,
    lastName: typeof body.lastName === "string" ? body.lastName.trim() : undefined,
    password: typeof body.password === "string" ? body.password : undefined,
    roles,
    enabled: body.enabled === undefined ? true : body.enabled === true,
  });
  if (!result.ok) {return Response.json({ error: result.reason }, { status: 400 });}

  const created = body.username;
  await recordAudit({
    principalId: principalUsername(auth.principal),
    action: "operator_create",
    targetId: typeof created === "string" ? created : result.id,
    status: "ok",
    details: { roles, identityProvider: "keycloak" },
  });
  return Response.json({ ok: true, id: result.id, username: created });
}

export async function PATCH(req: Request) {
  const auth = guardPermission(req, "maxxi.operators.manage");
  if (!auth.ok) {return auth.response;}
  if (!readAdminConfig()) {return keycloakUnavailable();}

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const id = typeof body.id === "string" ? body.id : "";
  if (!id) {return Response.json({ error: "id utente mancante." }, { status: 400 });}

  const actor = principalUsername(auth.principal);
  const targetUsername = typeof body.username === "string" ? body.username : "";
  if (body.enabled === false && targetUsername && targetUsername.toLowerCase() === actor.toLowerCase()) {
    return Response.json({ error: "Non puoi disattivare il tuo stesso account." }, { status: 400 });
  }

  const patch: UserPatch = {};
  if (typeof body.email === "string") {patch.email = body.email.trim();}
  if (typeof body.firstName === "string") {patch.firstName = body.firstName.trim();}
  if (typeof body.lastName === "string") {patch.lastName = body.lastName.trim();}
  if (typeof body.password === "string" && body.password.length > 0) {patch.password = body.password;}
  if (body.roles !== undefined) {patch.roles = parseRoles(body.roles);}
  if (body.enabled !== undefined) {patch.enabled = body.enabled === true;}

  const result = await updateUser(id, patch);
  if (!result.ok) {return Response.json({ error: result.reason }, { status: 400 });}

  await recordAudit({
    principalId: actor,
    action: "operator_update",
    targetId: targetUsername || id,
    status: "ok",
    details: { roles: patch.roles, enabled: patch.enabled, identityProvider: "keycloak" },
  });
  return Response.json({ ok: true, id });
}

export async function DELETE(req: Request) {
  const auth = guardPermission(req, "maxxi.operators.manage");
  if (!auth.ok) {return auth.response;}
  if (!readAdminConfig()) {return keycloakUnavailable();}

  const url = new URL(req.url);
  const id = url.searchParams.get("id")?.trim() ?? "";
  if (!id) {return Response.json({ error: "id utente mancante." }, { status: 400 });}

  const users = await listUsers();
  const target = users?.find((user) => user.id === id);
  if (!target) {return Response.json({ error: "Utente non trovato." }, { status: 404 });}

  const actor = principalUsername(auth.principal);
  if (target.username.toLowerCase() === actor.toLowerCase()) {
    return Response.json({ error: "Non puoi eliminare il tuo stesso account." }, { status: 400 });
  }

  const result = await deleteUser(id);
  if (!result.ok) {return Response.json({ error: result.reason }, { status: 400 });}

  await recordAudit({
    principalId: actor,
    action: "operator_delete",
    targetId: target.username,
    status: "ok",
    details: { identityProvider: "keycloak" },
  });
  return Response.json({ ok: true, id });
}
