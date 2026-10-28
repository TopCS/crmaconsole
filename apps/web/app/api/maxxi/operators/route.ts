/**
 * /api/maxxi/operators — admin-only account management.
 *
 * GET    → list accounts (no hashes).
 * POST   → create/update an account ({ username, password?, roles[], active? }).
 * DELETE ?username= → remove an account (cannot remove yourself).
 */

import { guardPermission, principalUsername } from "../_guard";
import { deleteOperator, readOperators, upsertOperator, type OperatorAccount } from "@/lib/security/operators";
import { isRole, type OperatorRole } from "@/lib/security/rbac";
import { recordAudit } from "@/lib/maxxi/queries";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function sanitize(account: OperatorAccount) {
  return {
    username: account.username,
    roles: account.roles,
    active: account.active,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
    createdBy: account.createdBy,
  };
}

export async function GET(req: Request) {
  const auth = guardPermission(req, "maxxi.operators.manage");
  if (!auth.ok) {return auth.response;}
  return Response.json({ ok: true, operators: readOperators().map(sanitize) });
}

export async function POST(req: Request) {
  const auth = guardPermission(req, "maxxi.operators.manage");
  if (!auth.ok) {return auth.response;}

  let body: {
    username?: unknown;
    password?: unknown;
    roles?: unknown;
    active?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const username = typeof body.username === "string" ? body.username : "";
  const password = typeof body.password === "string" ? body.password : undefined;
  const roles = Array.isArray(body.roles)
    ? body.roles.filter((role): role is OperatorRole => typeof role === "string" && isRole(role))
    : [];
  const active = body.active === undefined ? true : body.active === true;

  const result = upsertOperator({
    username,
    password: password && password.length > 0 ? password : undefined,
    roles,
    active,
    createdBy: principalUsername(auth.principal),
  });
  if (!result.ok) {return Response.json({ error: result.reason }, { status: 400 });}

  await recordAudit({
    principalId: principalUsername(auth.principal),
    action: "operator_upsert",
    targetId: result.username,
    status: "ok",
    details: { roles, active },
  });
  return Response.json({ ok: true, username: result.username });
}

export async function DELETE(req: Request) {
  const auth = guardPermission(req, "maxxi.operators.manage");
  if (!auth.ok) {return auth.response;}

  const url = new URL(req.url);
  const username = url.searchParams.get("username")?.trim().toLowerCase() ?? "";
  if (!username) {return Response.json({ error: "username is required." }, { status: 400 });}
  if (username === principalUsername(auth.principal).toLowerCase()) {
    return Response.json({ error: "Non puoi eliminare il tuo stesso account." }, { status: 400 });
  }

  const result = deleteOperator(username);
  if (!result.ok) {return Response.json({ error: result.reason }, { status: 400 });}

  await recordAudit({
    principalId: principalUsername(auth.principal),
    action: "operator_delete",
    targetId: username,
    status: "ok",
    details: {},
  });
  return Response.json({ ok: true, username });
}
