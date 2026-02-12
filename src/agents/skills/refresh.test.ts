import { describe, expect, it, vi } from "vitest";

const watchMock = vi.fn(() => ({
  on: vi.fn(),
  close: vi.fn(async () => undefined),
}));

vi.mock("chokidar", () => {
  return {
    default: { watch: watchMock },
  };
});

vi.mock("./bundled-dir.js", () => ({
  resolveBundledSkillsDir: () => "/mock/package/root/skills",
}));

describe("ensureSkillsWatcher", () => {
  it("ignores node_modules, dist, and .git by default", async () => {
    const mod = await import("./refresh.js");
    mod.ensureSkillsWatcher({ workspaceDir: "/tmp/workspace" });

    expect(watchMock).toHaveBeenCalledTimes(1);
    const opts = watchMock.mock.calls[0]?.[1] as { ignored?: unknown };

    expect(opts.ignored).toBe(mod.DEFAULT_SKILLS_WATCH_IGNORED);
    const ignored = mod.DEFAULT_SKILLS_WATCH_IGNORED;
    expect(ignored.some((re) => re.test("/tmp/workspace/skills/node_modules/pkg/index.js"))).toBe(
      true,
    );
    expect(ignored.some((re) => re.test("/tmp/workspace/skills/dist/index.js"))).toBe(true);
    expect(ignored.some((re) => re.test("/tmp/workspace/skills/.git/config"))).toBe(true);
    expect(ignored.some((re) => re.test("/tmp/.hidden/skills/index.md"))).toBe(false);
  });

  it("includes bundled skills dir in watch paths", async () => {
    watchMock.mockClear();
    const mod = await import("./refresh.js");
    // Force a fresh watcher by using a different workspace dir
    mod.ensureSkillsWatcher({ workspaceDir: "/tmp/workspace-bundled-test" });

    expect(watchMock).toHaveBeenCalledTimes(1);
    const watchedPaths = watchMock.mock.calls[0]?.[0] as string[];

    // Should include workspace skills, managed skills, and bundled skills
    expect(watchedPaths).toContain("/tmp/workspace-bundled-test/skills");
    expect(watchedPaths).toContain("/mock/package/root/skills");
  });
});
