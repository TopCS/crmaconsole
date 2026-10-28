/**
 * SQL exposure guard (SEC-04).
 *
 * Arbitrary SQL over the network is a latent data-exfiltration and
 * data-destruction primitive. Regex blocklists are not a security boundary, so
 * this module implements a positive allowlist instead:
 *
 *   - exactly one statement (no ';' except a single trailing one),
 *   - must start with SELECT or WITH,
 *   - no DDL/DML/administration keywords anywhere (comments stripped first),
 *   - every FROM/JOIN target must be an allowlisted relation (tables/views).
 *
 * Anything outside the allowlist is rejected. Endpoints using this must also be
 * operator-authenticated; this is defence in depth, not the only control.
 */

/** Relations the CDP read surface may touch. */
const ALLOWED_RELATIONS = new Set<string>([
  "entries",
  "entry_fields",
  "fields",
  "objects",
  "relations",
  "relation_fields",
  "v_segment",
  "v_people",
  "v_interaction",
  "v_campaign",
  "v_order",
  "v_product",
]);

const FORBIDDEN_KEYWORDS =
  /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|TRUNCATE|ATTACH|DETACH|COPY|EXPORT|IMPORT|INSTALL|LOAD|PRAGMA|CALL|SET|GRANT|REVOKE|VACUUM|CHECKPOINT|BEGIN|COMMIT|ROLLBACK)\b/i;

function stripComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ");
}

export type SqlGuardResult = { ok: true; sql: string } | { ok: false; reason: string };

export function guardReadOnlySql(raw: string, maxLength = 20_000): SqlGuardResult {
  if (typeof raw !== "string" || raw.trim() === "") {
    return { ok: false, reason: "Missing SQL." };
  }
  if (raw.length > maxLength) {
    return { ok: false, reason: "SQL too long." };
  }

  const cleaned = stripComments(raw).trim();

  // Exactly one statement: allow a single trailing semicolon only.
  const withoutTrailing = cleaned.replace(/;\s*$/, "");
  if (withoutTrailing.includes(";")) {
    return { ok: false, reason: "Multiple statements are not allowed." };
  }

  if (!/^(SELECT|WITH)\b/i.test(withoutTrailing)) {
    return { ok: false, reason: "Only read-only SELECT queries are allowed." };
  }

  if (FORBIDDEN_KEYWORDS.test(withoutTrailing)) {
    return { ok: false, reason: "Query contains a forbidden keyword." };
  }

  // Every relation referenced after FROM/JOIN must be allowlisted, or be a CTE
  // name defined in the same statement.
  const cteNames = new Set<string>();
  for (const match of withoutTrailing.matchAll(/\b(?:WITH|,)\s+([A-Za-z_]\w*)\s+AS\s*\(/gi)) {
    cteNames.add(match[1].toLowerCase());
  }

  const relationPattern = /\b(?:FROM|JOIN)\s+([A-Za-z_][\w.]*)/gi;
  const seen = new Set<string>();
  for (const match of withoutTrailing.matchAll(relationPattern)) {
    const relation = match[1].split(".").pop()?.toLowerCase() ?? "";
    if (relation && !cteNames.has(relation)) {seen.add(relation);}
  }
  const unknown = [...seen].filter((relation) => !ALLOWED_RELATIONS.has(relation));
  if (unknown.length > 0) {
    return { ok: false, reason: `Relation not allowed: ${unknown.join(", ")}` };
  }

  return { ok: true, sql: withoutTrailing };
}
