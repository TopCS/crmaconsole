"use client";

import { useState } from "react";

type SkillStoreTab = "installed" | "browse";

const TABS: { id: SkillStoreTab; label: string }[] = [
  { id: "installed", label: "Installed" },
  { id: "browse", label: "Browse" },
];

export function SkillStorePanel() {
  const [activeTab, setActiveTab] = useState<SkillStoreTab>("installed");

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
            Manage and discover agent skills
          </p>
        </div>
      </div>

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

      {activeTab === "installed" && (
        <div
          className="p-8 text-center rounded-2xl"
          style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)" }}
        >
          <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
            Installed skills will appear here.
          </p>
        </div>
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
