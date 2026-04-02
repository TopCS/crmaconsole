"use client";

import { useState } from "react";
import type { ComposioToolkit } from "@/lib/composio";

function LogoBox({ logo, name }: { logo: string | null; name: string }) {
  const [failed, setFailed] = useState(false);
  const showImg = logo && !failed;
  return (
    <div
      className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl"
      style={{
        background: "var(--color-surface-hover)",
      }}
    >
      {showImg ? (
        <img
          src={logo}
          alt=""
          className="h-6 w-6 object-contain"
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
        />
      ) : (
        <span
          className="text-xs font-semibold uppercase"
          style={{ color: "var(--color-text-muted)" }}
        >
          {name.slice(0, 2)}
        </span>
      )}
    </div>
  );
}

function ArrowUpRightIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ display: "inline", verticalAlign: "middle" }}>
      <line x1="7" y1="17" x2="17" y2="7" />
      <polyline points="7 7 17 7 17 17" />
    </svg>
  );
}

export function ComposioAppCard({
  toolkit,
  activeConnections,
  totalConnections,
  mode = "marketplace",
  onClick,
}: {
  toolkit: ComposioToolkit;
  activeConnections: number;
  totalConnections?: number;
  featured?: boolean;
  mode?: "connected" | "marketplace";
  onClick: () => void;
}) {
  const connected = activeConnections > 0;
  const primaryLabel = connected ? "Manage" : "Connect";

  return (
    <div
      className="group rounded-2xl p-4 flex flex-col gap-2 cursor-pointer"
      style={{
        background: "var(--color-surface)",
        border: "1px solid var(--color-border)",
      }}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onClick(); }}
      aria-label={`${primaryLabel} ${toolkit.name}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <LogoBox logo={toolkit.logo} name={toolkit.name} />
          <div className="min-w-0">
            <div className="text-sm font-medium truncate" style={{ color: "var(--color-text)" }}>
              {toolkit.name}
            </div>
            <div className="flex items-center gap-1.5 mt-0.5">
              {toolkit.tools_count > 0 && (
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded-full"
                  style={{
                    background: "var(--color-surface-hover)",
                    color: "var(--color-text-muted)",
                  }}
                >
                  {toolkit.tools_count} tool{toolkit.tools_count === 1 ? "" : "s"}
                </span>
              )}
              {connected && (
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded-full"
                  style={{
                    background: "color-mix(in srgb, var(--color-success, #22c55e) 12%, transparent)",
                    color: "var(--color-success, #22c55e)",
                  }}
                >
                  {activeConnections} account{activeConnections === 1 ? "" : "s"}
                </span>
              )}
              {connected && typeof totalConnections === "number" && totalConnections > activeConnections && (
                <span className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>
                  {totalConnections} total
                </span>
              )}
            </div>
          </div>
        </div>

        <span
          className="shrink-0 text-[11px] px-2.5 py-1 rounded-lg font-medium opacity-0 group-hover:opacity-100 transition-opacity"
          style={{
            background: "var(--color-surface-hover)",
            color: "var(--color-text)",
          }}
        >
          {mode === "marketplace" && <ArrowUpRightIcon />}{" "}
          {primaryLabel}
        </span>
      </div>

      {toolkit.description && (
        <p className="text-xs leading-relaxed line-clamp-2" style={{ color: "var(--color-text-muted)" }}>
          {toolkit.description}
        </p>
      )}
    </div>
  );
}
