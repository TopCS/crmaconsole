/**
 * RBAC for the MAXXI demo (SEC-03 + PRD roles).
 *
 * Permissions are coarse-grained (resource.action) and evaluated on the
 * server for every request. The UI uses the same role list only to hide
 * controls; the enforcement is in the API. Service principals get a fixed
 * read-only + dry-run concession, never writes to people/consents.
 */

export const ROLES = [
  "admin",
  "communication",
  "membership",
  "infopoint",
  "relations",
] as const;

export type OperatorRole = (typeof ROLES)[number];

export const isRole = (value: string): value is OperatorRole =>
  (ROLES as readonly string[]).includes(value);

/** Named permissions used by the MAXXI API. */
export type MaxxiPermission =
  | "maxxi.view"
  | "maxxi.people.read"
  | "maxxi.people.eligible"
  | "maxxi.people.review"
  | "maxxi.membership.read"
  | "maxxi.feedback.manage"
  | "maxxi.feedback.viewNotes"
  | "maxxi.organizations.read"
  | "maxxi.relations.read"
  | "maxxi.campaigns.create"
  | "maxxi.campaigns.approve"
  | "maxxi.seed"
  | "maxxi.operators.manage";

const ROLE_PERMISSIONS: Record<OperatorRole, readonly MaxxiPermission[]> = {
  admin: [
    "maxxi.view",
    "maxxi.people.read",
    "maxxi.people.eligible",
    "maxxi.people.review",
    "maxxi.membership.read",
    "maxxi.feedback.manage",
    "maxxi.feedback.viewNotes",
    "maxxi.organizations.read",
    "maxxi.relations.read",
    "maxxi.campaigns.create",
    "maxxi.campaigns.approve",
    "maxxi.seed",
    "maxxi.operators.manage",
  ],
  communication: [
    "maxxi.view",
    "maxxi.people.read",
    "maxxi.people.eligible",
    "maxxi.campaigns.create",
    "maxxi.campaigns.approve",
  ],
  membership: [
    "maxxi.view",
    "maxxi.people.read",
    "maxxi.people.eligible",
    "maxxi.membership.read",
  ],
  infopoint: [
    "maxxi.view",
    "maxxi.people.read",
    "maxxi.feedback.manage",
    "maxxi.feedback.viewNotes",
  ],
  relations: [
    "maxxi.view",
    "maxxi.organizations.read",
    "maxxi.relations.read",
  ],
};

export function roleHasPermission(roles: readonly OperatorRole[], permission: MaxxiPermission): boolean {
  return roles.some((role) => ROLE_PERMISSIONS[role]?.includes(permission));
}

/**
 * Concession for the service principal (agent tools).
 *
 * Read-only on personal data, plus the dry-run campaign draft: it writes a
 * draft row and an audit entry, never contacts a provider and never touches
 * people/consents. Approval, seeding and account management stay operator-only.
 */
export const SERVICE_READ_PERMISSIONS: readonly MaxxiPermission[] = [
  "maxxi.view",
  "maxxi.people.read",
  "maxxi.people.eligible",
  "maxxi.membership.read",
  "maxxi.organizations.read",
  "maxxi.relations.read",
  "maxxi.campaigns.create",
];

export type PermissionCheck =
  | { ok: true; principal: { sub: "operator"; username: string; roles: OperatorRole[] } | { sub: "service" } }
  | { ok: false; response: Response };

export function labelForRole(role: OperatorRole): string {
  switch (role) {
    case "admin": return "Amministratore";
    case "communication": return "Comunicazione";
    case "membership": return "Membership";
    case "infopoint": return "Infopoint";
    case "relations": return "Relazioni";
  }
}
