"use client";

import { useEffect, useState, useCallback, useMemo } from "react";

type SkillStoreTab = "installed" | "browse";

type InstalledSkill = {
  name: string;
  slug: string;
  description: string;
  emoji?: string;
  source: string;
  filePath: string;
  protected: boolean;
};

const TABS: { id: SkillStoreTab; label: string }[] = [
  { id: "installed", label: "Installed" },
  { id: "browse", label: "Browse" },
];

export function SkillStorePanel() {
  const [activeTab, setActiveTab] = useState<SkillStoreTab>("installed");
  const [installedSkills, setInstalledSkills] = useState<InstalledSkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [removingSlug, setRemovingSlug] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const fetchInstalled = useCallback(async () => {
    try {
      const res = await fetch("/api/skills");
      const data = await res.json();
      setInstalledSkills(data.skills ?? []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchInstalled();
  }, [fetchInstalled]);

  const handleRemove = useCallback(async (slug: string) => {
    setRemovingSlug(slug);
    try {
      const res = await fetch(`/api/skills/${encodeURIComponent(slug)}`, { method: "DELETE" });
      const data = await res.json();
      if (data.ok) {
        setInstalledSkills((prev) => prev.filter((s) => s.slug !== slug));
      }
    } catch {
      // ignore
    } finally {
      setRemovingSlug(null);
      setConfirmRemove(null);
    }
  }, []);

  const filteredInstalled = useMemo(() => {
    if (!searchQuery.trim()) return installedSkills;
    const q = searchQuery.toLowerCase();
    return installedSkills.filter(
      (s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q),
    );
  }, [installedSkills, searchQuery]);

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-end justify-between mb-6">
        <div>
          <h1
            className="font-instrument text-3xl tracking-tight mb-1"
            style={{ color: "var(--color-text)" }}
          >
            Skill Store
          </h1>
          <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
            {installedSkills.length} skill{installedSkills.length !== 1 ? "s" : ""} installed
          </p>
        </div>
      </div>

      {/* Tab bar */}
      <div
        className="flex items-center gap-1 mb-6 rounded-xl p-1"
        style={{ background: "var(--color-surface-hover)" }}
      >
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className="px-4 py-1.5 rounded-lg text-sm font-medium transition-all cursor-pointer"
            style={{
              background: activeTab === tab.id ? "var(--color-surface)" : "transparent",
              color: activeTab === tab.id ? "var(--color-text)" : "var(--color-text-muted)",
              boxShadow: activeTab === tab.id ? "var(--shadow-sm)" : "none",
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Search (only for installed tab for now) */}
      {activeTab === "installed" && (
        <div className="mb-4">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter installed skills..."
            className="w-full px-3 py-2 rounded-xl text-sm outline-none"
            style={{
              background: "var(--color-surface)",
              border: "1px solid var(--color-border)",
              color: "var(--color-text)",
            }}
          />
        </div>
      )}

      {activeTab === "installed" && (
        <InstalledTab
          skills={filteredInstalled}
          loading={loading}
          removingSlug={removingSlug}
          confirmRemove={confirmRemove}
          onConfirmRemove={setConfirmRemove}
          onRemove={handleRemove}
        />
      )}

      {activeTab === "browse" && (
        <div
          className="p-8 text-center rounded-2xl"
          style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)" }}
        >
          <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
            Browse skills from ClawHub coming soon.
          </p>
        </div>
      )}
    </div>
  );
}

function InstalledTab({
  skills,
  loading,
  removingSlug,
  confirmRemove,
  onConfirmRemove,
  onRemove,
}: {
  skills: InstalledSkill[];
  loading: boolean;
  removingSlug: string | null;
  confirmRemove: string | null;
  onConfirmRemove: (slug: string | null) => void;
  onRemove: (slug: string) => void;
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div
          className="w-6 h-6 border-2 rounded-full animate-spin"
          style={{ borderColor: "var(--color-border)", borderTopColor: "var(--color-accent)" }}
        />
      </div>
    );
  }

  if (skills.length === 0) {
    return (
      <div
        className="p-8 text-center rounded-2xl"
        style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)" }}
      >
        <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
          No installed skills found.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {skills.map((skill) => (
        <div
          key={skill.slug}
          className="rounded-2xl p-4 flex flex-col gap-2"
          style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)" }}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              {skill.emoji && <span className="text-lg flex-shrink-0">{skill.emoji}</span>}
              <div className="min-w-0">
                <div className="text-sm font-medium truncate" style={{ color: "var(--color-text)" }}>
                  {skill.name}
                </div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded-full"
                    style={{
                      background: skill.source === "managed"
                        ? "color-mix(in srgb, var(--color-accent) 12%, transparent)"
                        : "var(--color-surface-hover)",
                      color: skill.source === "managed"
                        ? "var(--color-accent)"
                        : "var(--color-text-muted)",
                    }}
                  >
                    {skill.source}
                  </span>
                  {skill.protected && (
                    <span
                      className="text-[10px] px-1.5 py-0.5 rounded-full flex items-center gap-1"
                      style={{
                        background: "color-mix(in srgb, var(--color-warning, #f59e0b) 12%, transparent)",
                        color: "var(--color-warning, #f59e0b)",
                      }}
                      title="This skill is required by DenchClaw"
                    >
                      <LockIcon />
                      protected
                    </span>
                  )}
                </div>
              </div>
            </div>
            {!skill.protected && (
              <div className="flex-shrink-0">
                {confirmRemove === skill.slug ? (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => onRemove(skill.slug)}
                      disabled={removingSlug === skill.slug}
                      className="text-[11px] px-2 py-1 rounded-lg cursor-pointer transition-colors"
                      style={{
                        background: "color-mix(in srgb, var(--color-error, #ef4444) 12%, transparent)",
                        color: "var(--color-error, #ef4444)",
                      }}
                    >
                      {removingSlug === skill.slug ? (
                        <span className="flex items-center gap-1">
                          <span
                            className="w-3 h-3 border border-current rounded-full animate-spin"
                            style={{ borderTopColor: "transparent" }}
                          />
                          Removing...
                        </span>
                      ) : (
                        "Confirm"
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => onConfirmRemove(null)}
                      className="text-[11px] px-2 py-1 rounded-lg cursor-pointer"
                      style={{ color: "var(--color-text-muted)" }}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => onConfirmRemove(skill.slug)}
                    className="text-[11px] px-2 py-1 rounded-lg cursor-pointer transition-colors"
                    style={{ color: "var(--color-text-muted)" }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLElement).style.background = "color-mix(in srgb, var(--color-error, #ef4444) 8%, transparent)";
                      (e.currentTarget as HTMLElement).style.color = "var(--color-error, #ef4444)";
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.background = "transparent";
                      (e.currentTarget as HTMLElement).style.color = "var(--color-text-muted)";
                    }}
                  >
                    Remove
                  </button>
                )}
              </div>
            )}
          </div>
          {skill.description && (
            <p className="text-xs leading-relaxed line-clamp-2" style={{ color: "var(--color-text-muted)" }}>
              {skill.description}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

function LockIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}
