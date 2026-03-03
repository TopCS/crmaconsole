import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import type { Dirent } from "node:fs";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => ""),
  readdirSync: vi.fn(() => []),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  renameSync: vi.fn(),
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
}));

vi.mock("node:os", () => ({
  homedir: vi.fn(() => "/home/testuser"),
}));

describe("profiles API", () => {
  const originalEnv = { ...process.env };
  const DEFAULT_STATE_DIR = join("/home/testuser", ".openclaw");
  const WORK_STATE_DIR = join("/home/testuser", ".openclaw-work");
  const WORK_WORKSPACE_DIR = join(WORK_STATE_DIR, "workspace");

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

  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
    delete process.env.OPENCLAW_PROFILE;
    delete process.env.OPENCLAW_HOME;
    delete process.env.OPENCLAW_WORKSPACE;
    delete process.env.OPENCLAW_STATE_DIR;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("lists discovered profiles and includes gateway metadata", async () => {
    process.env.OPENCLAW_PROFILE = "work";
    const { existsSync, readFileSync, readdirSync } = await import("node:fs");
    const mockExists = vi.mocked(existsSync);
    const mockReadFile = vi.mocked(readFileSync);
    const mockReaddir = vi.mocked(readdirSync);

    mockReaddir.mockReturnValue([
      makeDirent(".openclaw-work", true),
      makeDirent("Documents", true),
    ] as unknown as Dirent[]);
    mockExists.mockImplementation((p) => {
      const s = String(p);
      return (
        s === DEFAULT_STATE_DIR ||
        s === join(DEFAULT_STATE_DIR, "openclaw.json") ||
        s === WORK_WORKSPACE_DIR ||
        s === join(WORK_STATE_DIR, "openclaw.json")
      );
    });
    mockReadFile.mockImplementation((p) => {
      const s = String(p);
      if (s === join(WORK_STATE_DIR, "openclaw.json")) {
        return JSON.stringify({ gateway: { mode: "local", port: 19001 } }) as never;
      }
      if (s === join(DEFAULT_STATE_DIR, "openclaw.json")) {
        return JSON.stringify({ gateway: { mode: "local", port: 18789 } }) as never;
      }
      return "" as never;
    });

    const { GET } = await import("./route.js");
    const response = await GET();
    expect(response.status).toBe(200);
    const json = await response.json();

    expect(json.activeProfile).toBe("work");
    const work = json.profiles.find((p: { name: string }) => p.name === "work");
    const def = json.profiles.find((p: { name: string }) => p.name === "default");
    expect(work).toMatchObject({
      name: "work",
      stateDir: WORK_STATE_DIR,
      workspaceDir: WORK_WORKSPACE_DIR,
      isActive: true,
      hasConfig: true,
      gateway: {
        mode: "local",
        port: 19001,
        url: "ws://127.0.0.1:19001",
      },
    });
    expect(def).toMatchObject({
      name: "default",
      stateDir: DEFAULT_STATE_DIR,
      isActive: false,
      hasConfig: true,
      gateway: {
        mode: "local",
        port: 18789,
        url: "ws://127.0.0.1:18789",
      },
    });
  });

  it("switches to an existing profile", async () => {
    const { existsSync, readdirSync, readFileSync } = await import("node:fs");
    const mockExists = vi.mocked(existsSync);
    const mockReaddir = vi.mocked(readdirSync);
    const mockReadFile = vi.mocked(readFileSync);
    mockReadFile.mockImplementation(() => {
      throw new Error("ENOENT");
    });
    mockReaddir.mockReturnValue([makeDirent(".openclaw-work", true)] as unknown as Dirent[]);
    mockExists.mockImplementation((p) => {
      const s = String(p);
      return s === WORK_WORKSPACE_DIR;
    });

    const { POST } = await import("./switch/route.js");
    const req = new Request("http://localhost/api/profiles/switch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile: "work" }),
    });

    const response = await POST(req);
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.activeProfile).toBe("work");
    expect(json.stateDir).toBe(WORK_STATE_DIR);
    expect(json.workspaceRoot).toBe(WORK_WORKSPACE_DIR);
    expect(json.profile.name).toBe("work");
  });

  it("rejects invalid switch profile names", async () => {
    const { POST } = await import("./switch/route.js");
    const req = new Request("http://localhost/api/profiles/switch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile: "../bad" }),
    });
    const response = await POST(req);
    expect(response.status).toBe(400);
  });

  it("returns 404 when switching to an unknown profile", async () => {
    const { readdirSync, readFileSync } = await import("node:fs");
    const mockReaddir = vi.mocked(readdirSync);
    const mockReadFile = vi.mocked(readFileSync);
    mockReadFile.mockImplementation(() => {
      throw new Error("ENOENT");
    });
    mockReaddir.mockReturnValue([] as unknown as Dirent[]);

    const { POST } = await import("./switch/route.js");
    const req = new Request("http://localhost/api/profiles/switch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile: "work" }),
    });
    const response = await POST(req);
    expect(response.status).toBe(404);
  });

  it("returns 409 when OPENCLAW_PROFILE forces a different profile", async () => {
    process.env.OPENCLAW_PROFILE = "ironclaw";
    const { readdirSync } = await import("node:fs");
    const mockReaddir = vi.mocked(readdirSync);
    mockReaddir.mockReturnValue([makeDirent(".openclaw-work", true)] as unknown as Dirent[]);

    const { POST } = await import("./switch/route.js");
    const req = new Request("http://localhost/api/profiles/switch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile: "work" }),
    });
    const response = await POST(req);
    expect(response.status).toBe(409);
  });
});
