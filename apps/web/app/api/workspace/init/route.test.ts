import { EventEmitter } from "node:events";
import { join } from "node:path";
import type { Dirent } from "node:fs";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => ""),
  readdirSync: vi.fn(() => []),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  copyFileSync: vi.fn(),
  cpSync: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execSync: vi.fn(() => ""),
  exec: vi.fn(
    (
      _cmd: string,
      _opts: unknown,
      cb: (err: Error | null, result: { stdout: string }) => void,
    ) => {
      cb(null, { stdout: "" });
    },
  ),
  spawn: vi.fn(),
}));

vi.mock("node:os", () => ({
  homedir: vi.fn(() => "/home/testuser"),
}));

describe("POST /api/workspace/init", () => {
  const originalEnv = { ...process.env };
  const HOME = "/home/testuser";
  const IRONCLAW_STATE = join(HOME, ".openclaw-ironclaw");
  const WORK_STATE = join(HOME, ".openclaw-work");
  const IRONCLAW_CONFIG = join(IRONCLAW_STATE, "openclaw.json");
  const IRONCLAW_AUTH = join(IRONCLAW_STATE, "agents", "main", "agent", "auth-profiles.json");

  function makeDirent(name: string, isDir: boolean): Dirent {
    return {
      name,
      isDirectory: () => isDir,
      isFile: () => !isDir,
      isBlockDevice: () => false,
      isCharacterDevice: () => false,
      isFIFO: () => false,
      isSocket: () => false,
      isSymbolicLink: () => false,
      path: "",
      parentPath: "",
    } as Dirent;
  }

  function mockSpawnExit(code: number, stderr = "") {
    return vi.fn(() => {
      const child = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
        kill: ReturnType<typeof vi.fn>;
      };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = vi.fn();
      queueMicrotask(() => {
        if (stderr) {
          child.stderr.emit("data", Buffer.from(stderr));
        }
        child.emit("close", code);
      });
      return child as unknown as ReturnType<typeof import("node:child_process").spawn>;
    });
  }

  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
    delete process.env.OPENCLAW_PROFILE;
    delete process.env.OPENCLAW_HOME;
    delete process.env.OPENCLAW_WORKSPACE;
    delete process.env.OPENCLAW_STATE_DIR;

    vi.mock("node:fs", () => ({
      existsSync: vi.fn(() => false),
      readFileSync: vi.fn(() => ""),
      readdirSync: vi.fn(() => []),
      writeFileSync: vi.fn(),
      mkdirSync: vi.fn(),
      copyFileSync: vi.fn(),
      cpSync: vi.fn(),
    }));
    vi.mock("node:child_process", () => ({
      execSync: vi.fn(() => ""),
      exec: vi.fn(
        (
          _cmd: string,
          _opts: unknown,
          cb: (err: Error | null, result: { stdout: string }) => void,
        ) => {
          cb(null, { stdout: "" });
        },
      ),
      spawn: vi.fn(),
    }));
    vi.mock("node:os", () => ({
      homedir: vi.fn(() => "/home/testuser"),
    }));
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  async function callInit(body: Record<string, unknown>) {
    const { POST } = await import("./route.js");
    const req = new Request("http://localhost/api/workspace/init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return POST(req);
  }

  it("rejects missing or invalid profile names", async () => {
    const missing = await callInit({});
    expect(missing.status).toBe(400);

    const invalid = await callInit({ profile: "../bad" });
    expect(invalid.status).toBe(400);
  });

  it("returns 409 when the profile already exists", async () => {
    const { readdirSync, readFileSync } = await import("node:fs");
    const mockReaddir = vi.mocked(readdirSync);
    const mockReadFile = vi.mocked(readFileSync);
    mockReaddir.mockReturnValue([makeDirent(".openclaw-work", true)] as unknown as Dirent[]);
    mockReadFile.mockImplementation(() => {
      throw new Error("ENOENT");
    });

    const response = await callInit({ profile: "work" });
    expect(response.status).toBe(409);
  });

  it("creates a profile, copies config/auth, allocates gateway port, and runs onboard", async () => {
    const { existsSync, readFileSync, readdirSync, copyFileSync } = await import("node:fs");
    const { spawn } = await import("node:child_process");
    const mockExists = vi.mocked(existsSync);
    const mockReadFile = vi.mocked(readFileSync);
    const mockReaddir = vi.mocked(readdirSync);
    const mockCopyFile = vi.mocked(copyFileSync);
    const mockSpawn = vi.mocked(spawn);

    mockSpawn.mockImplementation(mockSpawnExit(0));
    mockReaddir.mockReturnValue([
      makeDirent(".openclaw-ironclaw", true),
      makeDirent("Documents", true),
    ] as unknown as Dirent[]);
    mockExists.mockImplementation((p) => {
      const s = String(p);
      return (
        s === IRONCLAW_CONFIG ||
        s === IRONCLAW_AUTH ||
        s.endsWith("docs/reference/templates/AGENTS.md") ||
        s.endsWith("assets/seed/workspace.duckdb")
      );
    });
    mockReadFile.mockImplementation((p) => {
      const s = String(p);
      if (s === IRONCLAW_CONFIG) {
        return JSON.stringify({ gateway: { mode: "local", port: 18789 } }) as never;
      }
      if (s.endsWith("/openclaw.json")) {
        return JSON.stringify({}) as never;
      }
      if (s.endsWith("/AGENTS.md")) {
        return "# AGENTS\n" as never;
      }
      return "" as never;
    });

    const response = await callInit({
      profile: "work",
      seedBootstrap: true,
      copyConfigAuth: true,
    });
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.profile).toBe("work");
    expect(json.stateDir).toBe(WORK_STATE);
    expect(json.gatewayPort).toBe(18809);
    expect(json.copiedFiles).toEqual(
      expect.arrayContaining(["openclaw.json", "agents/main/agent/auth-profiles.json"]),
    );
    expect(json.activeProfile).toBe("work");

    const onboardCall = mockSpawn.mock.calls.find(
      (call) =>
        String(call[0]) === "openclaw" &&
        Array.isArray(call[1]) &&
        (call[1] as string[]).includes("onboard"),
    );
    expect(onboardCall).toBeTruthy();
    const args = onboardCall?.[1] as string[];
    expect(args).toEqual(
      expect.arrayContaining([
        "--profile",
        "work",
        "onboard",
        "--install-daemon",
        "--gateway-port",
        "18809",
        "--non-interactive",
        "--accept-risk",
        "--skip-ui",
      ]),
    );
    expect(mockCopyFile).toHaveBeenCalledWith(IRONCLAW_CONFIG, join(WORK_STATE, "openclaw.json"));
    expect(mockCopyFile).toHaveBeenCalledWith(
      IRONCLAW_AUTH,
      join(WORK_STATE, "agents", "main", "agent", "auth-profiles.json"),
    );
  });

  it("returns 500 when onboard fails", async () => {
    const { readdirSync, readFileSync, existsSync } = await import("node:fs");
    const { spawn } = await import("node:child_process");
    const mockReaddir = vi.mocked(readdirSync);
    const mockReadFile = vi.mocked(readFileSync);
    const mockExists = vi.mocked(existsSync);
    const mockSpawn = vi.mocked(spawn);

    mockSpawn.mockImplementation(mockSpawnExit(1, "onboard error"));
    mockReaddir.mockReturnValue([makeDirent(".openclaw-ironclaw", true)] as unknown as Dirent[]);
    mockExists.mockImplementation((p) => String(p) === IRONCLAW_CONFIG || String(p) === IRONCLAW_AUTH);
    mockReadFile.mockImplementation((p) => {
      if (String(p) === IRONCLAW_CONFIG) {
        return JSON.stringify({ gateway: { port: 18789 } }) as never;
      }
      return "" as never;
    });

    const response = await callInit({ profile: "work" });
    expect(response.status).toBe(500);
    const json = await response.json();
    expect(String(json.error)).toContain("onboarding failed");
  });
});
