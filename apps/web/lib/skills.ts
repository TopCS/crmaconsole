import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type SkillMetadata = {
  name?: string;
  description?: string;
  emoji?: string;
};

export type SkillsLockEntry = {
  slug: string;
  source: string;
  installedAt: string;
  installedFrom: "skills.sh";
};

export type SkillsLock = Record<string, SkillsLockEntry>;

/** Parse YAML frontmatter from a SKILL.md file (lightweight, no deps). */
export function parseSkillFrontmatter(content: string): SkillMetadata {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) {
    return {};
  }

  const yaml = match[1];
  const result: Record<string, string> = {};
  for (const line of yaml.split("\n")) {
    const kv = line.match(/^(\w+)\s*:\s*(.+)/);
    if (kv) {
      result[kv[1]] = kv[2].replace(/^["']|["']$/g, "").trim();
    }
  }

  return {
    name: result.name,
    description: result.description,
    emoji: result.emoji,
  };
}

export function readSkillsLock(workspaceRoot: string): SkillsLock {
  const lockFile = join(workspaceRoot, ".skills", "lock.json");
  if (!existsSync(lockFile)) {
    return {};
  }

  try {
    const parsed = JSON.parse(readFileSync(lockFile, "utf-8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return parsed as SkillsLock;
  } catch {
    return {};
  }
}

export function writeSkillsLock(workspaceRoot: string, lock: SkillsLock): void {
  const lockDir = join(workspaceRoot, ".skills");
  mkdirSync(lockDir, { recursive: true });
  writeFileSync(join(lockDir, "lock.json"), JSON.stringify(lock, null, 2));
}

export function removeSkillsLockEntry(workspaceRoot: string, slug: string): void {
  const lock = readSkillsLock(workspaceRoot);
  if (!(slug in lock)) {
    return;
  }
  delete lock[slug];
  writeSkillsLock(workspaceRoot, lock);
}
