/**
 * Operator accounts store.
 *
 * Accounts live in a JSON file under the demo state dir (isolated, like the
 * MAXXI database). Passwords are hashed with scrypt + a per-account salt;
 * nothing is ever stored in plain text and no credentials are hardcoded.
 *
 * Bootstrap: when the store is empty and the environment defines a first admin
 * (CRM_A_ADMIN_USERNAME + CRM_A_ADMIN_PASSWORD), the first login attempt
 * creates that account. After that, accounts are managed by an admin from the
 * UI/API.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import path from "node:path";
import { maxxiDemoDir } from "../maxxi/store";
import { isRole, type OperatorRole } from "./rbac";

export type OperatorAccount = {
  username: string;
  salt: string;
  hash: string;
  roles: OperatorRole[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
};

export function operatorsStorePath(): string {
  const dir = maxxiDemoDir();
  return path.join(dir, "operators.json");
}

function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, 64).toString("hex");
}

export function readOperators(): OperatorAccount[] {
  const file = operatorsStorePath();
  if (!existsSync(file)) {return [];}
  try {
    const raw = JSON.parse(readFileSync(file, "utf-8")) as OperatorAccount[];
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

export function saveOperators(accounts: OperatorAccount[]): void {
  const dir = maxxiDemoDir();
  if (!existsSync(dir)) {mkdirSync(dir, { recursive: true });}
  writeFileSync(operatorsStorePath(), JSON.stringify(accounts, null, 2), "utf-8");
}

export function findOperator(username: string): OperatorAccount | null {
  const normalized = username.trim().toLowerCase();
  return readOperators().find((account) => account.username.toLowerCase() === normalized) ?? null;
}

/** Constant-time check of a candidate password against an account. */
export function verifyOperatorPassword(account: OperatorAccount, password: string): boolean {
  const candidate = Buffer.from(hashPassword(password, account.salt), "utf-8");
  const stored = Buffer.from(account.hash, "utf-8");
  if (candidate.length !== stored.length) {return false;}
  return timingSafeEqual(candidate, stored);
}

export type VerifyResult = { ok: true; account: OperatorAccount } | { ok: false; reason: string };

export function verifyCredentials(username: string, password: string): VerifyResult {
  const account = findOperator(username);
  if (!account) {return { ok: false, reason: "invalid_credentials" };}
  if (!account.active) {return { ok: false, reason: "account_disabled" };}
  if (!verifyOperatorPassword(account, password)) {return { ok: false, reason: "invalid_credentials" };}
  return { ok: true, account };
}

/** Create or replace an account (admin-only, from the API). */
export function upsertOperator(params: {
  username: string;
  password?: string;
  roles: OperatorRole[];
  active: boolean;
  createdBy: string;
}): { ok: true; username: string } | { ok: false; reason: string } {
  const username = params.username.trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) {
    return { ok: false, reason: "Username non valido (3-32 caratteri, solo a-z 0-9 . _ -)." };
  }
  if (params.roles.length === 0 || !params.roles.every(isRole)) {
    return { ok: false, reason: "Almeno un ruolo valido è richiesto." };
  }
  if (params.password !== undefined && params.password.length < 8) {
    return { ok: false, reason: "Password troppo corta (minimo 8 caratteri)." };
  }

  const accounts = readOperators();
  const existing = accounts.find((account) => account.username === username);
  const now = new Date().toISOString();

  const account: OperatorAccount = {
    username,
    salt: existing?.salt ?? randomBytes(16).toString("hex"),
    hash: params.password !== undefined
      ? hashPassword(params.password, existing?.salt ?? randomBytes(16).toString("hex"))
      : existing?.hash ?? "",
    roles: params.roles,
    active: params.active,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    createdBy: params.createdBy,
  };

  if (params.password === undefined && !existing) {
    return { ok: false, reason: "Serve una password alla creazione." };
  }
  if (params.password !== undefined) {
    account.salt = randomBytes(16).toString("hex");
    account.hash = hashPassword(params.password, account.salt);
  }

  if (existing) {
    saveOperators(accounts.map((account_) => (account_.username === username ? account : account_)));
  } else {
    saveOperators([...accounts, account]);
  }
  return { ok: true, username };
}

export function deleteOperator(username: string): { ok: true } | { ok: false; reason: string } {
  const accounts = readOperators();
  const next = accounts.filter((account) => account.username !== username.trim().toLowerCase());
  if (next.length === accounts.length) {return { ok: false, reason: "Account non trovato." };}
  saveOperators(next);
  return { ok: true };
}

/** Bootstrap: create the first admin from env when the store is empty. */
export function bootstrapAdminIfNeeded(): { ok: true; username: string } | { ok: false; reason: string } {
  if (readOperators().length > 0) {return { ok: false, reason: "Store non vuoto." };}
  const username = process.env.CRM_A_ADMIN_USERNAME?.trim().toLowerCase();
  const password = process.env.CRM_A_ADMIN_PASSWORD;
  if (!username || !password || password.length < 8) {
    return {
      ok: false,
      reason:
        "Nessun account configurato. Imposta CRM_A_ADMIN_USERNAME e CRM_A_ADMIN_PASSWORD per il primo accesso.",
    };
  }
  return upsertOperator({
    username,
    password,
    roles: ["admin"],
    active: true,
    createdBy: "bootstrap",
  });
}
