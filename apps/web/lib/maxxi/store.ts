/**
 * MAXXI demo store — an isolated DuckDB file for the museum vertical.
 *
 * Isolation rationale (REG-001 / "preserve existing workspaces"): the demo
 * lives in its own database under the OpenClaw state dir, never in the shared
 * CRM workspace. Reset is a drop-and-recreate of this file's tables, so no
 * other workspace can be mutated by seeding or resetting the demo.
 *
 * The schema is relational rather than the EAV used by the CRM workspace: the
 * demo needs provenance columns (source_system/source_record_id/observed_at)
 * and deterministic aggregates, which are awkward on EAV. The deviation is
 * recorded in the decision log.
 */

import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  duckdbExecOnFileAsync,
  duckdbQueryOnFileAsync,
  resolveDuckdbBin,
  resolveOpenClawStateDir,
} from "../workspace";

export const MAXXI_WORKSPACE_ID = "demo-maxxi-cdp-2026";

/** Fixed clock so segments/KPIs are reproducible across runs and tests. */
export const MAXXI_CLOCK_ISO = "2026-10-28T12:00:00+01:00";
export const MAXXI_NOW_MS = Date.parse(MAXXI_CLOCK_ISO);

export function maxxiDemoDir(): string {
  const override = process.env.CRM_A_MAXXI_DB_DIR?.trim();
  if (override) {return override;}
  return path.join(resolveOpenClawStateDir(), "maxxi-demo");
}

export function maxxiDbPath(): string {
  return path.join(maxxiDemoDir(), "maxxi.duckdb");
}

/** Quack endpoint shared by every server-side MAXXI query, when configured. */
export function maxxiQuackUrl(): string | null {
  const value = process.env.MAXXI_QUACK_URL?.trim();
  return value ? value : null;
}

/** Shared secret for the private Quack sidecar. Never sent to the browser. */
export function maxxiQuackToken(): string | null {
  const value = process.env.MAXXI_QUACK_TOKEN?.trim();
  return value ? value : null;
}

/** Internal Compose networking is plain HTTP; opt in to TLS explicitly. */
function maxxiQuackDisableSsl(): boolean {
  const raw = process.env.MAXXI_QUACK_DISABLE_SSL?.trim().toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "no";
}

/** `quack` when the sidecar is configured, `duckdb-file` in local dev/tests. */
export function maxxiBackend(): "quack" | "duckdb-file" {
  return maxxiQuackUrl() && maxxiQuackToken() ? "quack" : "duckdb-file";
}

function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Route one statement to the Quack sidecar.
 *
 * `catalog.query(...)` executes arbitrary SQL remotely, so callers keep
 * sending plain SQL. The client process still starts per request, but it no
 * longer opens the database file: there is no exclusive lock and no schema
 * bootstrap on the hot path.
 */
export function buildMaxxiQuackSql(sql: string): string {
  const url = maxxiQuackUrl();
  const token = maxxiQuackToken();
  if (!url || !token) {
    throw new Error("Quack is not configured (MAXXI_QUACK_URL / MAXXI_QUACK_TOKEN).");
  }
  const attachOptions = `TOKEN ${sqlLiteral(token)}${maxxiQuackDisableSsl() ? ", DISABLE_SSL true" : ""}`;
  return (
    `LOAD quack;` +
    `ATTACH ${sqlLiteral(url)} AS maxxi_quack (${attachOptions});` +
    `FROM maxxi_quack.query(${sqlLiteral(sql)});`
  );
}

/**
 * Drive the DuckDB CLI through stdin. The seed batch is hundreds of KB and
 * would exceed the OS argument limit with `-c`; stdin has no such limit.
 */
function runDuckdbStdin(
  bin: string,
  args: string[],
  sql: string,
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGTERM");
    }, timeoutMs);
    proc.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf-8"); });
    proc.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf-8"); });
    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`duckdb timed out after ${timeoutMs}ms`));
        return;
      }
      if (code !== 0) {
        reject(Object.assign(new Error(stderr.trim() || `duckdb exited ${code}`), { stderr }));
        return;
      }
      resolve({ stdout, stderr });
    });
    proc.stdin.on("error", () => {});
    proc.stdin.write(sql);
    proc.stdin.end();
  });
}

async function maxxiQuackQuery<T>(sql: string): Promise<T[]> {
  const bin = resolveDuckdbBin();
  if (!bin) {return [];}
  try {
    const { stdout } = await runDuckdbStdin(bin, ["-json"], buildMaxxiQuackSql(sql), 30_000);
    const trimmed = stdout.trim();
    if (!trimmed || trimmed === "[]") {return [];}
    return JSON.parse(trimmed) as T[];
  } catch (err) {
    console.error(`[maxxi] quack query failed: ${(err as Error).message}`);
    return [];
  }
}

async function maxxiQuackExec(sql: string): Promise<boolean> {
  const bin = resolveDuckdbBin();
  if (!bin) {return false;}
  try {
    await runDuckdbStdin(bin, [], buildMaxxiQuackSql(sql), 60_000);
    return true;
  } catch (err) {
    const stderr = (err as { stderr?: string | Buffer }).stderr;
    const detail =
      typeof stderr === "string"
        ? stderr
        : Buffer.isBuffer(stderr)
          ? stderr.toString("utf-8")
          : (err as Error).message;
    console.error(`[maxxi] quack exec failed: ${detail.slice(0, 800)}`);
    return false;
  }
}

export function ensureMaxxiDir(): string {
  const dir = maxxiDemoDir();
  if (!existsSync(dir)) {mkdirSync(dir, {recursive: true});}
  return dir;
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS maxxi_person (
  person_id VARCHAR PRIMARY KEY,
  name VARCHAR,
  email VARCHAR,
  language VARCHAR,
  synthetic BOOLEAN DEFAULT TRUE,
  created_at VARCHAR
);
CREATE TABLE IF NOT EXISTS maxxi_person_interest (
  person_id VARCHAR,
  interest VARCHAR,
  kind VARCHAR,
  PRIMARY KEY (person_id, interest, kind)
);
CREATE TABLE IF NOT EXISTS maxxi_organization (
  organization_id VARCHAR PRIMARY KEY,
  name VARCHAR,
  relationship_kind VARCHAR,
  synthetic BOOLEAN DEFAULT TRUE
);
CREATE TABLE IF NOT EXISTS maxxi_relationship (
  relationship_id VARCHAR PRIMARY KEY,
  person_id VARCHAR,
  organization_id VARCHAR,
  type VARCHAR,
  source_system VARCHAR,
  source_record_id VARCHAR
);
CREATE TABLE IF NOT EXISTS maxxi_identity_link (
  link_id VARCHAR PRIMARY KEY,
  person_id VARCHAR,
  source_system VARCHAR,
  source_record_id VARCHAR,
  match_method VARCHAR,
  confidence DOUBLE,
  status VARCHAR,
  matched_at VARCHAR,
  reviewed_by VARCHAR,
  reviewed_at VARCHAR,
  UNIQUE (source_system, source_record_id)
);
CREATE TABLE IF NOT EXISTS maxxi_review_candidate (
  candidate_id VARCHAR PRIMARY KEY,
  name VARCHAR,
  email VARCHAR,
  source_system VARCHAR,
  source_record_id VARCHAR,
  reason VARCHAR,
  status VARCHAR,
  created_at VARCHAR
);
CREATE TABLE IF NOT EXISTS maxxi_consent (
  consent_id VARCHAR PRIMARY KEY,
  person_id VARCHAR,
  purpose VARCHAR,
  channel VARCHAR,
  status VARCHAR,
  captured_at VARCHAR,
  withdrawn_at VARCHAR,
  source_system VARCHAR,
  source_record_id VARCHAR,
  UNIQUE (person_id, purpose, channel)
);
CREATE TABLE IF NOT EXISTS maxxi_catalog_item (
  catalog_id VARCHAR PRIMARY KEY,
  title VARCHAR,
  type VARCHAR,
  start_date VARCHAR,
  end_date VARCHAR,
  source_url VARCHAR,
  is_public_real BOOLEAN
);
CREATE TABLE IF NOT EXISTS maxxi_event (
  event_id VARCHAR PRIMARY KEY,
  person_id VARCHAR,
  anonymous_subject_id VARCHAR,
  type VARCHAR,
  occurred_at VARCHAR,
  observed_at VARCHAR,
  source_system VARCHAR,
  source_record_id VARCHAR,
  catalog_item_id VARCHAR,
  properties_json VARCHAR,
  UNIQUE (source_system, source_record_id, type)
);
CREATE TABLE IF NOT EXISTS maxxi_membership (
  membership_id VARCHAR PRIMARY KEY,
  person_id VARCHAR,
  card_code VARCHAR,
  product VARCHAR,
  valid_from VARCHAR,
  valid_to VARCHAR,
  status VARCHAR,
  source_system VARCHAR,
  source_record_id VARCHAR,
  recorded_at VARCHAR
);
CREATE TABLE IF NOT EXISTS maxxi_feedback_case (
  case_id VARCHAR PRIMARY KEY,
  person_id VARCHAR,
  channel VARCHAR,
  category VARCHAR,
  status VARCHAR,
  opened_at VARCHAR,
  closed_at VARCHAR,
  summary VARCHAR,
  source_system VARCHAR,
  source_record_id VARCHAR
);
CREATE TABLE IF NOT EXISTS maxxi_source_registry (
  source_system VARCHAR PRIMARY KEY,
  description VARCHAR,
  mock_or_live VARCHAR,
  last_imported_at VARCHAR,
  last_import_status VARCHAR,
  row_count INTEGER,
  unmatched_count INTEGER,
  quarantined_count INTEGER
);
CREATE TABLE IF NOT EXISTS maxxi_campaign (
  campaign_id VARCHAR PRIMARY KEY,
  segment_id VARCHAR,
  subject VARCHAR,
  body VARCHAR,
  created_by VARCHAR,
  status VARCHAR,
  delivery_mode VARCHAR,
  created_at VARCHAR
);
CREATE TABLE IF NOT EXISTS maxxi_campaign_version (
  version_id VARCHAR PRIMARY KEY,
  campaign_id VARCHAR,
  version INTEGER,
  subject VARCHAR,
  body VARCHAR,
  created_by VARCHAR,
  created_at VARCHAR
);
CREATE TABLE IF NOT EXISTS maxxi_campaign_snapshot (
  snapshot_id VARCHAR PRIMARY KEY,
  campaign_id VARCHAR,
  approved_by VARCHAR,
  approved_at VARCHAR,
  recipients_json VARCHAR,
  exclusions_json VARCHAR,
  counts_json VARCHAR
);
CREATE TABLE IF NOT EXISTS maxxi_review_decision (
  candidate_id VARCHAR PRIMARY KEY,
  decision VARCHAR,
  reason VARCHAR,
  decided_by VARCHAR,
  decided_at VARCHAR
);
CREATE TABLE IF NOT EXISTS maxxi_action_audit (
  audit_id VARCHAR PRIMARY KEY,
  principal_id VARCHAR,
  action VARCHAR,
  target_id VARCHAR,
  requested_at VARCHAR,
  approved_at VARCHAR,
  status VARCHAR,
  details_sanitized VARCHAR
);
`;

let schemaReady: Promise<string> | null = null;

/**
 * Run the schema DDL once per process. Previously every query re-executed all
 * 17 `CREATE TABLE IF NOT EXISTS` statements, which dominated the small demo
 * queries and multiplied the lock contention.
 */
export function ensureMaxxiSchema(): Promise<string> {
  if (!schemaReady) {
    schemaReady = (async () => {
      ensureMaxxiDir();
      const dbPath = maxxiDbPath();
      const ok =
        maxxiBackend() === "quack"
          ? await maxxiQuackExec(SCHEMA_SQL)
          : await duckdbExecOnFileAsync(dbPath, SCHEMA_SQL);
      if (!ok) {throw new Error(`MAXXI schema bootstrap failed (${maxxiBackend()}).`);}
      return dbPath;
    })().catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

export async function maxxiQuery<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  await ensureMaxxiSchema();
  if (maxxiBackend() === "quack") {return maxxiQuackQuery<T>(sql);}
  return duckdbQueryOnFileAsync<T>(maxxiDbPath(), sql);
}

/**
 * Run several reads. Quack handles concurrent sessions, so parallelize there;
 * direct file access stays sequential to avoid DuckDB's exclusive lock.
 */
export async function maxxiRun<T extends readonly unknown[]>(
  tasks: { [K in keyof T]: () => Promise<T[K]> },
): Promise<T> {
  if (maxxiBackend() === "quack") {
    return Promise.all(tasks.map((task) => task())) as unknown as Promise<T>;
  }
  const results: unknown[] = [];
  for (const task of tasks) {
    results.push(await task());
  }
  return results as unknown as T;
}

export async function maxxiExec(sql: string): Promise<boolean> {
  await ensureMaxxiSchema();
  if (maxxiBackend() === "quack") {return maxxiQuackExec(sql);}
  return duckdbExecOnFileAsync(maxxiDbPath(), sql);
}

/** Reset = drop the demo tables only. Never touches other workspaces. */
export async function resetMaxxiDemo(): Promise<void> {
  await ensureMaxxiSchema();
  const tables = [
    "maxxi_person",
    "maxxi_person_interest",
    "maxxi_organization",
    "maxxi_relationship",
    "maxxi_identity_link",
    "maxxi_review_candidate",
    "maxxi_consent",
    "maxxi_catalog_item",
    "maxxi_event",
    "maxxi_membership",
    "maxxi_feedback_case",
    "maxxi_source_registry",
    "maxxi_campaign",
    "maxxi_campaign_version",
    "maxxi_campaign_snapshot",
    "maxxi_review_decision",
    "maxxi_action_audit",
  ];
  await maxxiExec(
    tables.map((table) => `DELETE FROM ${table};`).join("\n"),
  );
}

/** SQL literal helper (DuckDB). */
export function q(value: string | null | undefined): string {
  if (value === null || value === undefined) {return "NULL";}
  return `'${String(value).replace(/'/g, "''")}'`;
}
