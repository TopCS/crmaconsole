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
import { duckdbExecOnFileAsync, duckdbQueryOnFileAsync, resolveOpenClawStateDir } from "../workspace";

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

export async function ensureMaxxiSchema(): Promise<string> {
  ensureMaxxiDir();
  const dbPath = maxxiDbPath();
  await duckdbExecOnFileAsync(dbPath, SCHEMA_SQL);
  return dbPath;
}

export async function maxxiQuery<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  const dbPath = await ensureMaxxiSchema();
  return duckdbQueryOnFileAsync<T>(dbPath, sql);
}

export async function maxxiExec(sql: string): Promise<boolean> {
  const dbPath = await ensureMaxxiSchema();
  return duckdbExecOnFileAsync(dbPath, sql);
}

/** Reset = drop the demo tables only. Never touches other workspaces. */
export async function resetMaxxiDemo(): Promise<void> {
  const dbPath = await ensureMaxxiSchema();
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
  await duckdbExecOnFileAsync(
    dbPath,
    tables.map((table) => `DELETE FROM ${table};`).join("\n"),
  );
}

/** SQL literal helper (DuckDB). */
export function q(value: string | null | undefined): string {
  if (value === null || value === undefined) {return "NULL";}
  return `'${String(value).replace(/'/g, "''")}'`;
}
