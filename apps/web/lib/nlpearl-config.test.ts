import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  readNlpearlConfig,
  writeNlpearlConfig,
  deleteNlpearlConfig,
} from "./nlpearl-config";

vi.mock("@/lib/workspace", () => ({
  resolveOpenClawStateDir: vi.fn(() => "/tmp/nlpearl-test"),
}));

const { resolveOpenClawStateDir } = await import("@/lib/workspace");
const mockedDir = vi.mocked(resolveOpenClawStateDir);

class FakeFs {
  files = new Map<string, string>();
  readFileSync(p: string) {
    if (!this.files.has(p)) {throw new Error("ENOENT");}
    return this.files.get(p)!;
  }
  writeFileSync(p: string, c: string) {this.files.set(p, c);}
  existsSync(p: string) {return this.files.has(p);}
  mkdirSync() {}
}
const fs = new FakeFs();

beforeEach(() => {
  vi.resetModules();
  vi.mock("node:fs", () => ({
    existsSync: (p: string) => fs.existsSync(p),
    readFileSync: (p: string) => fs.readFileSync(p),
    writeFileSync: (p: string, c: string) => fs.writeFileSync(p, c),
    mkdirSync: () => {},
  }));
  // clear between tests
  fs.files.clear();
  mockedDir.mockReturnValue("/tmp/nlpearl-test");
});

describe("nlpearl-config", () => {
  it("returns null when no config file", () => {
    expect(readNlpearlConfig()).toBeNull();
  });

  it("round-trips write → read and trims fields", () => {
    writeNlpearlConfig({ accountId: "  ACC  ", secretKey: "  KEY  ", baseUrl: "https://api.example/v2", voiceId: "V1" });
    const cfg = readNlpearlConfig();
    expect(cfg?.accountId).toBe("ACC");
    expect(cfg?.secretKey).toBe("KEY");
    expect(cfg?.baseUrl).toBe("https://api.example/v2");
    expect(cfg?.voiceId).toBe("V1");
  });

  it("returns null on a partial/invalid file", () => {
    fs.files.set("/tmp/nlpearl-test/.crm-a-nlpearl.json", JSON.stringify({ accountId: "a" }));
    expect(readNlpearlConfig()).toBeNull();
  });

  it("delete clears the config", () => {
    writeNlpearlConfig({ accountId: "A", secretKey: "K" });
    deleteNlpearlConfig();
    expect(fs.files.get("/tmp/nlpearl-test/.crm-a-nlpearl.json")).toBe("");
  });
});