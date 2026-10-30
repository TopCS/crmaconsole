import { afterEach, beforeEach, describe, expect, it } from "vitest";

const originalUrl = process.env.MAXXI_QUACK_URL;
const originalToken = process.env.MAXXI_QUACK_TOKEN;
const originalSsl = process.env.MAXXI_QUACK_DISABLE_SSL;

beforeEach(() => {
  process.env.MAXXI_QUACK_URL = "quack:maxxi-quack:9494";
  process.env.MAXXI_QUACK_TOKEN = "token'with-quote";
  process.env.MAXXI_QUACK_DISABLE_SSL = "1";
});

afterEach(() => {
  for (const [key, value] of [
    ["MAXXI_QUACK_URL", originalUrl],
    ["MAXXI_QUACK_TOKEN", originalToken],
    ["MAXXI_QUACK_DISABLE_SSL", originalSsl],
  ] as const) {
    if (value === undefined) {delete process.env[key];}
    else {process.env[key] = value;}
  }
});

describe("MAXXI store backend", () => {
  it("switches to Quack only when URL and token are both configured", async () => {
    const { maxxiBackend } = await import("./store");
    expect(maxxiBackend()).toBe("quack");
    delete process.env.MAXXI_QUACK_TOKEN;
    expect(maxxiBackend()).toBe("duckdb-file");
  });

  it("escapes the remote query and disables TLS for the internal sidecar", async () => {
    const { buildMaxxiQuackSql } = await import("./store");
    const sql = buildMaxxiQuackSql("SELECT 'x' AS value;");
    expect(sql).toContain("LOAD quack;");
    expect(sql).toContain("ATTACH 'quack:maxxi-quack:9494' AS maxxi_quack");
    expect(sql).toContain("TOKEN 'token''with-quote'");
    expect(sql).toContain("DISABLE_SSL true");
    expect(sql).toContain("query('SELECT ''x'' AS value;')");
  });
});
