/**
 * POST /api/auth/login — operator login (individual accounts + RBAC).
 *
 * Body: { username, password }
 * On first run, when the account store is empty, an admin account is created
 * from CRM_A_ADMIN_USERNAME + CRM_A_ADMIN_PASSWORD (operator-provided, never
 * hardcoded). After that, accounts are managed by an admin.
 */

import {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  readSessionSecret,
  signSessionToken,
} from "@/lib/security/session";
import {
  bootstrapAdminIfNeeded,
  readOperators,
  verifyCredentials,
} from "@/lib/security/operators";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function noAccountsError(): { error: string; hint: string } {
  return {
    error: "Nessun account operatore configurato.",
    hint: "Imposta CRM_A_ADMIN_USERNAME e CRM_A_ADMIN_PASSWORD per creare il primo account admin.",
  };
}

export async function POST(req: Request) {
  if (!readSessionSecret()) {
    return Response.json(
      { error: "Login disabled: CRM_A_SESSION_SECRET is not configured." },
      { status: 503 },
    );
  }

  let body: { username?: unknown; password?: unknown };
  try {
    body = (await req.json()) as { username?: unknown; password?: unknown };
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const username = typeof body.username === "string" ? body.username.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";

  // Bootstrap admin on the very first login when the store is empty.
  if (readOperators().length === 0) {
    const boot = bootstrapAdminIfNeeded();
    if (!boot.ok) {
      return Response.json(noAccountsError(), { status: 503 });
    }
  }

  const result = verifyCredentials(username, password);
  if (!result.ok) {
    const status = result.reason === "account_disabled" ? 403 : 401;
    return Response.json({ error: "Credenziali non valide." }, { status });
  }

  const token = signSessionToken(result.account.username, result.account.roles);
  if (!token) {
    return Response.json(
      { error: "Session unavailable: CRM_A_SESSION_SECRET is not configured." },
      { status: 503 },
    );
  }

  const secure = new URL(req.url).protocol === "https:";
  const cookie = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${SESSION_TTL_SECONDS}`,
    ...(secure ? ["Secure"] : []),
  ].join("; ");

  return Response.json(
    { ok: true, username: result.account.username, roles: result.account.roles },
    { headers: { "set-cookie": cookie } },
  );
}
