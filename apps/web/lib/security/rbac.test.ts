import { describe, expect, it } from "vitest";
import {
  ROLES,
  SERVICE_READ_PERMISSIONS,
  isRole,
  labelForRole,
  roleHasPermission,
  type MaxxiPermission,
} from "./rbac";

describe("RBAC", () => {
  it("recognises only known roles", () => {
    for (const role of ROLES) {expect(isRole(role)).toBe(true);}
    expect(isRole("superuser")).toBe(false);
    expect(isRole("")).toBe(false);
  });

  it("gives admin every permission", () => {
    const all: MaxxiPermission[] = [
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
    ];
    for (const permission of all) {
      expect(roleHasPermission(["admin"], permission)).toBe(true);
    }
  });

  it("lets communication create and approve campaigns but not seed or manage operators", () => {
    expect(roleHasPermission(["communication"], "maxxi.campaigns.create")).toBe(true);
    expect(roleHasPermission(["communication"], "maxxi.campaigns.approve")).toBe(true);
    expect(roleHasPermission(["communication"], "maxxi.seed")).toBe(false);
    expect(roleHasPermission(["communication"], "maxxi.operators.manage")).toBe(false);
    expect(roleHasPermission(["communication"], "maxxi.feedback.viewNotes")).toBe(false);
  });

  it("restricts infopoint notes to infopoint and admin", () => {
    expect(roleHasPermission(["infopoint"], "maxxi.feedback.viewNotes")).toBe(true);
    expect(roleHasPermission(["admin"], "maxxi.feedback.viewNotes")).toBe(true);
    expect(roleHasPermission(["membership"], "maxxi.feedback.viewNotes")).toBe(false);
    expect(roleHasPermission(["communication"], "maxxi.feedback.viewNotes")).toBe(false);
    expect(roleHasPermission(["relations"], "maxxi.feedback.viewNotes")).toBe(false);
  });

  it("reserves identity review decisions to admin", () => {
    expect(roleHasPermission(["admin"], "maxxi.people.review")).toBe(true);
    for (const role of ["communication", "membership", "infopoint", "relations"] as const) {
      expect(roleHasPermission([role], "maxxi.people.review")).toBe(false);
    }
  });

  it("keeps relations out of personal data except organisations", () => {
    expect(roleHasPermission(["relations"], "maxxi.organizations.read")).toBe(true);
    expect(roleHasPermission(["relations"], "maxxi.relations.read")).toBe(true);
    expect(roleHasPermission(["relations"], "maxxi.people.eligible")).toBe(false);
    expect(roleHasPermission(["relations"], "maxxi.campaigns.create")).toBe(false);
  });

  it("combines roles (union of permissions)", () => {
    expect(roleHasPermission(["membership", "communication"], "maxxi.campaigns.create")).toBe(true);
    expect(roleHasPermission(["membership", "communication"], "maxxi.membership.read")).toBe(true);
  });

  it("denies everything to an empty role list", () => {
    expect(roleHasPermission([], "maxxi.view")).toBe(false);
  });

  it("never grants personal-data writes, approvals, seeding or account management to the service concession", () => {
    const denied: MaxxiPermission[] = [
      "maxxi.campaigns.approve",
      "maxxi.seed",
      "maxxi.operators.manage",
      "maxxi.feedback.manage",
      "maxxi.feedback.viewNotes",
    ];
    for (const permission of denied) {
      expect(SERVICE_READ_PERMISSIONS.includes(permission)).toBe(false);
    }
    // The only write is the audited dry-run draft.
    expect(SERVICE_READ_PERMISSIONS.includes("maxxi.campaigns.create")).toBe(true);
    expect(SERVICE_READ_PERMISSIONS.includes("maxxi.people.read")).toBe(true);
  });

  it("has an Italian label for every role", () => {
    for (const role of ROLES) {
      expect(labelForRole(role).length).toBeGreaterThan(2);
    }
  });
});
