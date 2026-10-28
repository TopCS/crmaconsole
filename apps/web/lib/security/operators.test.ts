import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "maxxi-operators-"));
process.env.CRM_A_MAXXI_DB_DIR = dir;
delete process.env.CRM_A_ADMIN_USERNAME;
delete process.env.CRM_A_ADMIN_PASSWORD;

const {
  bootstrapAdminIfNeeded,
  deleteOperator,
  findOperator,
  readOperators,
  upsertOperator,
  verifyCredentials,
} = await import("./operators");

beforeAll(() => {
  delete process.env.CRM_A_ADMIN_USERNAME;
  delete process.env.CRM_A_ADMIN_PASSWORD;
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("operator accounts", () => {
  it("starts empty and refuses bootstrap without env", () => {
    expect(readOperators()).toEqual([]);
    const result = bootstrapAdminIfNeeded();
    expect(result.ok).toBe(false);
  });

  it("creates an account and verifies the password", () => {
    const created = upsertOperator({
      username: "maria.rossi",
      password: "password-1234",
      roles: ["communication"],
      active: true,
      createdBy: "test",
    });
    expect(created.ok).toBe(true);

    const account = findOperator("maria.rossi");
    expect(account?.roles).toEqual(["communication"]);
    expect(account?.hash).not.toContain("password-1234");

    expect(verifyCredentials("maria.rossi", "password-1234").ok).toBe(true);
    expect(verifyCredentials("maria.rossi", "wrong-password").ok).toBe(false);
    expect(verifyCredentials("unknown", "password-1234").ok).toBe(false);
  });

  it("is case-insensitive on the username", () => {
    upsertOperator({
      username: "Luca.Neri",
      password: "password-1234",
      roles: ["membership"],
      active: true,
      createdBy: "test",
    });
    expect(findOperator("luca.neri")?.username).toBe("luca.neri");
    expect(verifyCredentials("LUCA.NERI", "password-1234").ok).toBe(true);
  });

  it("rejects short passwords, empty roles and bad usernames", () => {
    expect(upsertOperator({ username: "ok.user", password: "short", roles: ["admin"], active: true, createdBy: "t" }).ok).toBe(false);
    expect(upsertOperator({ username: "ok.user", password: "password-1234", roles: [], active: true, createdBy: "t" }).ok).toBe(false);
    expect(upsertOperator({ username: "A B", password: "password-1234", roles: ["admin"], active: true, createdBy: "t" }).ok).toBe(false);
    expect(upsertOperator({ username: "new.user", roles: ["admin"], active: true, createdBy: "t" }).ok).toBe(false);
  });

  it("updates roles without touching the password", () => {
    const before = findOperator("maria.rossi");
    upsertOperator({ username: "maria.rossi", roles: ["communication", "membership"], active: true, createdBy: "test" });
    const after = findOperator("maria.rossi");
    expect(after?.roles).toEqual(["communication", "membership"]);
    expect(after?.hash).toBe(before?.hash);
    expect(verifyCredentials("maria.rossi", "password-1234").ok).toBe(true);
  });

  it("rotates the password and invalidates the old one", () => {
    upsertOperator({ username: "maria.rossi", password: "new-password-99", roles: ["communication"], active: true, createdBy: "test" });
    expect(verifyCredentials("maria.rossi", "password-1234").ok).toBe(false);
    expect(verifyCredentials("maria.rossi", "new-password-99").ok).toBe(true);
  });

  it("blocks a disabled account", () => {
    upsertOperator({ username: "maria.rossi", roles: ["communication"], active: false, createdBy: "test" });
    const result = verifyCredentials("maria.rossi", "new-password-99");
    expect(result.ok).toBe(false);
    if (!result.ok) {expect(result.reason).toBe("account_disabled");}
  });

  it("deletes accounts", () => {
    expect(deleteOperator("luca.neri").ok).toBe(true);
    expect(findOperator("luca.neri")).toBeNull();
    expect(deleteOperator("ghost").ok).toBe(false);
  });

  it("bootstraps the first admin when the store becomes empty", () => {
    for (const account of readOperators()) {deleteOperator(account.username);}
    process.env.CRM_A_ADMIN_USERNAME = "admin.demo";
    process.env.CRM_A_ADMIN_PASSWORD = "admin-password-1";
    const result = bootstrapAdminIfNeeded();
    expect(result.ok).toBe(true);
    expect(findOperator("admin.demo")?.roles).toEqual(["admin"]);
    expect(verifyCredentials("admin.demo", "admin-password-1").ok).toBe(true);
    delete process.env.CRM_A_ADMIN_USERNAME;
    delete process.env.CRM_A_ADMIN_PASSWORD;
  });
});
