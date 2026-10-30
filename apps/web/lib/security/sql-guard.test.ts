import { describe, expect, it } from "vitest";
import { guardReadOnlySql } from "./sql-guard";

describe("guardReadOnlySql", () => {
  it("allows a plain allowlisted SELECT", () => {
    const result = guardReadOnlySql("SELECT id FROM entries LIMIT 5");
    expect(result.ok).toBe(true);
  });

  it("allows a trailing semicolon", () => {
    expect(guardReadOnlySql("SELECT id FROM entries;").ok).toBe(true);
  });

  it("allows a CTE over allowlisted relations", () => {
    const sql =
      "WITH x AS (SELECT entry_id FROM entry_fields) SELECT * FROM x";
    expect(guardReadOnlySql(sql).ok).toBe(true);
  });

  it("rejects empty input", () => {
    expect(guardReadOnlySql("").ok).toBe(false);
    expect(guardReadOnlySql("   ").ok).toBe(false);
  });

  it("rejects multiple statements", () => {
    const result = guardReadOnlySql("SELECT 1 FROM entries; DROP TABLE entries");
    expect(result.ok).toBe(false);
  });

  it("rejects a trailing multi-statement after SELECT", () => {
    expect(guardReadOnlySql("SELECT * FROM entries; DELETE FROM entries").ok).toBe(false);
  });

  it("rejects non-SELECT statements", () => {
    for (const sql of [
      "DELETE FROM entries",
      "UPDATE entries SET id='x'",
      "DROP TABLE entries",
      "ATTACH 'x.db'",
      "PRAGMA database_list",
      "COPY entries TO 'x.csv'",
      "INSTALL httpfs",
    ]) {
      expect(guardReadOnlySql(sql).ok).toBe(false);
    }
  });

  it("rejects forbidden keywords hidden behind comments", () => {
    const sql = "SELECT id FROM entries -- harmless\n; DELETE FROM entries";
    expect(guardReadOnlySql(sql).ok).toBe(false);
  });

  it("rejects relations outside the allowlist", () => {
    expect(guardReadOnlySql("SELECT * FROM secrets").ok).toBe(false);
    expect(guardReadOnlySql("SELECT * FROM entries JOIN pg_catalog.user ON true").ok).toBe(false);
  });

  it("rejects oversized queries", () => {
    const sql = `SELECT id FROM entries WHERE value = '${"a".repeat(20_001)}'`;
    expect(guardReadOnlySql(sql).ok).toBe(false);
  });
});
