import { describe, expect, it } from "vitest";
import { applyCliProfileEnv, parseCliProfileArgs, CRM_A_CONSOLE_PROFILE } from "./profile.js";

describe("parseCliProfileArgs", () => {
  it("returns default profile parsing when no args are provided", () => {
    expect(parseCliProfileArgs(["node", "crm-a-console"])).toEqual({
      ok: true,
      profile: null,
      argv: ["node", "crm-a-console"],
    });
  });

  it("parses --profile and strips profile flags before command execution", () => {
    expect(parseCliProfileArgs(["node", "crm-a-console", "--profile", "dev", "chat"])).toEqual({
      ok: true,
      profile: "dev",
      argv: ["node", "crm-a-console", "chat"],
    });

    expect(parseCliProfileArgs(["node", "crm-a-console", "--profile=team-a", "status"])).toEqual({
      ok: true,
      profile: "team-a",
      argv: ["node", "crm-a-console", "status"],
    });
  });

  it("rejects missing and invalid profile inputs", () => {
    expect(parseCliProfileArgs(["node", "crm-a-console", "--profile"])).toEqual({
      ok: false,
      error: "--profile requires a value",
    });

    expect(parseCliProfileArgs(["node", "crm-a-console", "--profile", "bad profile"])).toEqual({
      ok: false,
      error: 'Invalid --profile (use letters, numbers, "_", "-" only)',
    });
  });

  it("allows --dev and --profile together (Crm-A Console forces crm-a anyway)", () => {
    const result = parseCliProfileArgs(["node", "crm-a-console", "--dev", "--profile", "team-a"]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.profile).toBe("team-a");
    }
  });

  it("stops profile parsing once command path begins", () => {
    expect(parseCliProfileArgs(["node", "crm-a-console", "chat", "--profile", "dev"])).toEqual({
      ok: true,
      profile: null,
      argv: ["node", "crm-a-console", "chat", "--profile", "dev"],
    });
  });
});

describe("applyCliProfileEnv", () => {
  it("always forces crm-a profile regardless of requested profile (single profile enforcement)", () => {
    const env: Record<string, string | undefined> = {};
    const result = applyCliProfileEnv({
      profile: "team-a",
      env,
      homedir: () => "/tmp/home",
    });

    expect(result.effectiveProfile).toBe(CRM_A_CONSOLE_PROFILE);
    expect(env.OPENCLAW_PROFILE).toBe(CRM_A_CONSOLE_PROFILE);
    expect(env.OPENCLAW_STATE_DIR).toBe("/tmp/home/.openclaw-crm-a");
    expect(env.OPENCLAW_CONFIG_PATH).toBe("/tmp/home/.openclaw-crm-a/openclaw.json");
  });

  it("emits warning when non-crm-a profile is requested (prevents silent override)", () => {
    const env: Record<string, string | undefined> = {};
    const result = applyCliProfileEnv({
      profile: "team-a",
      env,
      homedir: () => "/tmp/home",
    });

    expect(result.warning).toBeDefined();
    expect(result.warning).toContain("team-a");
    expect(result.warning).toContain(CRM_A_CONSOLE_PROFILE);
    expect(result.requestedProfile).toBe("team-a");
  });

  it("no warning when crm-a profile is requested (normal path)", () => {
    const env: Record<string, string | undefined> = {};
    const result = applyCliProfileEnv({
      profile: CRM_A_CONSOLE_PROFILE,
      env,
      homedir: () => "/tmp/home",
    });

    expect(result.warning).toBeUndefined();
    expect(result.effectiveProfile).toBe(CRM_A_CONSOLE_PROFILE);
  });

  it("no warning when no profile is specified (default path)", () => {
    const env: Record<string, string | undefined> = {};
    const result = applyCliProfileEnv({
      env,
      homedir: () => "/tmp/home",
    });

    expect(result.warning).toBeUndefined();
    expect(result.effectiveProfile).toBe(CRM_A_CONSOLE_PROFILE);
  });

  it("always overwrites OPENCLAW_STATE_DIR to pinned path (prevents state drift)", () => {
    const env: Record<string, string | undefined> = {
      OPENCLAW_STATE_DIR: "/custom/state",
      OPENCLAW_CONFIG_PATH: "/custom/state/openclaw.json",
    };
    const result = applyCliProfileEnv({
      profile: "dev",
      env,
      homedir: () => "/tmp/home",
    });

    expect(env.OPENCLAW_STATE_DIR).toBe("/tmp/home/.openclaw-crm-a");
    expect(env.OPENCLAW_CONFIG_PATH).toBe("/tmp/home/.openclaw-crm-a/openclaw.json");
    expect(result.stateDir).toBe("/tmp/home/.openclaw-crm-a");
  });

  it("picks up OPENCLAW_PROFILE from env when no explicit profile is passed", () => {
    const env: Record<string, string | undefined> = {
      OPENCLAW_PROFILE: "from-env",
    };
    const result = applyCliProfileEnv({
      env,
      homedir: () => "/tmp/home",
    });

    expect(result.requestedProfile).toBe("from-env");
    expect(result.effectiveProfile).toBe(CRM_A_CONSOLE_PROFILE);
    expect(result.warning).toContain("from-env");
  });

  it("both root and bootstrap-local profile forms resolve to same state dir", () => {
    const rootEnv: Record<string, string | undefined> = {};
    const bootstrapLocalEnv: Record<string, string | undefined> = {};
    applyCliProfileEnv({
      profile: "team-a",
      env: rootEnv,
      homedir: () => "/tmp/home",
    });
    applyCliProfileEnv({
      profile: "team-a",
      env: bootstrapLocalEnv,
      homedir: () => "/tmp/home",
    });

    expect(rootEnv.OPENCLAW_PROFILE).toBe(bootstrapLocalEnv.OPENCLAW_PROFILE);
    expect(rootEnv.OPENCLAW_STATE_DIR).toBe(bootstrapLocalEnv.OPENCLAW_STATE_DIR);
    expect(rootEnv.OPENCLAW_CONFIG_PATH).toBe(bootstrapLocalEnv.OPENCLAW_CONFIG_PATH);
  });
});
