/**
 * MAXXI demo API — shared guard helpers.
 *
 * Reads and dry-run writes are available to:
 *   - the operator (signed session cookie, UI), and
 *   - internal services (Bearer service token, agent tools).
 *
 * Both are authenticated principals; anonymous callers get 401. Writes here are
 * limited to seeding, campaign drafts and simulated approvals, all audited.
 */

import { readSessionFromRequest, requireService, type OperatorPrincipal } from "@/lib/security/session";

export type Principal = { sub: "operator" | "service" };

export type Guarded =
  | { ok: true; principal: Principal }
  | { ok: false; response: Response };

export function guard(req: Request): Guarded {
  const operator = readSessionFromRequest(req);
  if (operator) {return { ok: true, principal: { sub: "operator" }};}
  const service = requireService(req);
  if (service.ok) {return { ok: true, principal: service.principal };}
  return { ok: false, response: service.response };
}

/** Convenience for routes that must stay operator-only. */
export function guardOperatorOnly(req: Request): Guarded {
  const operator: OperatorPrincipal | null = readSessionFromRequest(req);
  if (operator) {return { ok: true, principal: { sub: "operator" }};}
  return { ok: false, response: Response.json({ error: "Unauthorized" }, { status: 401 }) };
}

export function jsonError(message: string, status = 400): Response {
  return Response.json({ error: message }, { status });
}

export const DEMO_BANNER = "DEMO - DATI SINTETICI - NESSUN INVIO ESTERNO";
