/**
 * MAXXI demo API — shared guard helpers with RBAC.
 *
 * Every request must carry a principal:
 *   - operator (signed session cookie) with at least one role, checked against
 *     the requested permission; or
 *   - service (Bearer token) granted the read-only + dry-run concession.
 *
 * Anonymous calls → 401. Authenticated calls without the permission → 403.
 * Writes here are limited to seeding (admin), campaign drafts/approvals
 * (communication/admin) and operator management (admin), all audited.
 */

import { readSessionFromRequest, requireService, type OperatorPrincipal } from "@/lib/security/session";
import {
  SERVICE_READ_PERMISSIONS,
  roleHasPermission,
  type MaxxiPermission,
  type OperatorRole,
} from "@/lib/security/rbac";

export type Principal =
  | { sub: "operator"; username: string; roles: OperatorRole[] }
  | { sub: "service" };

export type Guarded =
  | { ok: true; principal: Principal }
  | { ok: false; response: Response };

export function principalUsername(principal: Principal): string {
  return principal.sub === "operator" ? principal.username : "service";
}

/** Operator-only guard: returns the principal or a 401. */
export function guardOperatorOnly(req: Request): Guarded {
  const operator = readSessionFromRequest(req);
  if (operator) {
    return {
      ok: true,
      principal: { sub: "operator", username: operator.username, roles: operator.roles },
    };
  }
  return { ok: false, response: Response.json({ error: "Unauthorized" }, { status: 401 }) };
}

function forbidden(permission: MaxxiPermission): Response {
  return Response.json({ error: `Forbidden: missing permission ${permission}.` }, { status: 403 });
}

/**
 * Guard by permission. Returns ok when:
 *   - operator with a role that has `permission`; or
 *   - service with `permission` in the service concession.
 */
export function guardPermission(req: Request, permission: MaxxiPermission): Guarded {
  const operator = readSessionFromRequest(req);
  if (operator) {
    return roleHasPermission(operator.roles, permission)
      ? {
          ok: true,
          principal: { sub: "operator", username: operator.username, roles: operator.roles },
        }
      : { ok: false, response: forbidden(permission) };
  }
  const service = requireService(req);
  if (service.ok && SERVICE_READ_PERMISSIONS.includes(permission)) {
    return { ok: true, principal: { sub: "service" } };
  }
  return service.ok
    ? { ok: false, response: forbidden(permission) }
    : { ok: false, response: service.response };
}

/** Back-compat alias: any authenticated principal with maxxi.view. */
export function guard(req: Request): Guarded {
  return guardPermission(req, "maxxi.view");
}

export type OperatorPrincipalForAlias = OperatorPrincipal;

export function jsonError(message: string, status = 400): Response {
  return Response.json({ error: message }, { status });
}

export const DEMO_BANNER = "DEMO - DATI SINTETICI - NESSUN INVIO ESTERNO";
