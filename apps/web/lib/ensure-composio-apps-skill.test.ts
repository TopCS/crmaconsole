import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const seedSkill = vi.fn();

vi.mock("@/lib/project-root", () => ({
  resolveCrmAPackageRoot: vi.fn(),
}));

vi.mock("@/lib/workspace", () => ({
  resolveOpenClawStateDir: vi.fn(() => "/tmp/mock-openclaw-state"),
}));

vi.mock("@/lib/workspace-seed", () => ({
  discoverWorkspaceDirs: vi.fn(),
  MANAGED_SKILLS: [{ name: "crm-a-integrations" }],
  seedSkill,
}));

const { resolveCrmAPackageRoot } = await import("@/lib/project-root");
const { discoverWorkspaceDirs } = await import("@/lib/workspace-seed");
const { ensureComposioAppsSkillInWorkspaces } = await import("./ensure-composio-apps-skill");

describe("ensureComposioAppsSkillInWorkspaces", () => {
  let packageRoot: string;
  let workspaceDir: string;

  beforeEach(() => {
    seedSkill.mockReset();
    packageRoot = path.join(os.tmpdir(), `crm-a-package-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    workspaceDir = path.join(os.tmpdir(), `crm-a-workspace-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(path.join(packageRoot, "skills", "crm-a-integrations"), { recursive: true });
    mkdirSync(path.join(workspaceDir, "skills", "crm-a-integrations"), { recursive: true });
    vi.mocked(resolveCrmAPackageRoot).mockReturnValue(packageRoot);
    vi.mocked(discoverWorkspaceDirs).mockReturnValue([workspaceDir]);
  });

  afterEach(() => {
    rmSync(packageRoot, { recursive: true, force: true });
    rmSync(workspaceDir, { recursive: true, force: true });
  });

  it("re-seeds the skill when the bundled SKILL.md hash changes", () => {
    writeFileSync(
      path.join(packageRoot, "skills", "crm-a-integrations", "SKILL.md"),
      "# bundled skill\nUse Crm-A Integrations.\n",
      "utf-8",
    );
    writeFileSync(
      path.join(workspaceDir, "skills", "crm-a-integrations", "SKILL.md"),
      "# stale skill\nUse gog.\n",
      "utf-8",
    );

    ensureComposioAppsSkillInWorkspaces();

    expect(seedSkill).toHaveBeenCalledWith(
      { workspaceDir, packageRoot },
      { name: "crm-a-integrations" },
    );
  });

  it("does not rewrite the skill when the bundled hash matches", () => {
    const content = "# bundled skill\nUse Crm-A Integrations.\n";
    writeFileSync(path.join(packageRoot, "skills", "crm-a-integrations", "SKILL.md"), content, "utf-8");
    writeFileSync(path.join(workspaceDir, "skills", "crm-a-integrations", "SKILL.md"), content, "utf-8");

    ensureComposioAppsSkillInWorkspaces();

    expect(seedSkill).not.toHaveBeenCalled();
  });
});
