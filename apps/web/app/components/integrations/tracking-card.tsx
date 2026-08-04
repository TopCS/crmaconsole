"use client";

import { useEffect, useState } from "react";

/**
 * Web Tracking card (Integrations section): shows the workspace write key
 * and the tracker.js snippet to paste into a website so page views and
 * custom events flow into the CDP (Events section).
 */
export function TrackingCard() {
  const [snippet, setSnippet] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/events/tracking-config", { cache: "no-store" });
        if (!res.ok) {throw new Error(`HTTP ${res.status}`);}
        const data = (await res.json()) as { snippet?: string };
        if (!cancelled) {setSnippet(data.snippet ?? null);}
      } catch (err) {
        if (!cancelled) {setError(err instanceof Error ? err.message : "Failed to load");}
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const copy = async () => {
    if (!snippet) {return;}
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable */ }
  };

  return (
    <div
      className="rounded-xl p-4 space-y-3"
      style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)" }}
    >
      <div className="flex items-center gap-2">
        <svg
          className="h-4 w-4 shrink-0"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
        </svg>
        <h3 className="text-sm font-medium" style={{ color: "var(--color-text)" }}>
          Web Tracking
        </h3>
      </div>
      <p className="text-xs leading-relaxed" style={{ color: "var(--color-text-muted)" }}>
        Paste this snippet into your website to send page views and custom events into
        the Events section. Anonymous visitors are tracked with a cookie and merged
        into people when they identify.
      </p>
      {error ? (
        <p className="text-xs" style={{ color: "var(--color-error)" }}>{error}</p>
      ) : (
        <div className="flex items-start gap-2">
          <code
            className="flex-1 rounded-lg px-3 py-2 text-[11px] break-all"
            style={{
              background: "var(--color-background)",
              border: "1px solid var(--color-border)",
              color: "var(--color-text)",
            }}
          >
            {snippet ?? "Loading…"}
          </code>
          <button
            type="button"
            onClick={() => void copy()}
            disabled={!snippet}
            className="shrink-0 rounded-lg px-3 py-2 text-xs font-medium disabled:opacity-50"
            style={{
              background: "var(--color-accent)",
              color: "#fff",
            }}
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      )}
      <p className="text-[11px]" style={{ color: "var(--color-text-muted)" }}>
        Then call <code>crma.track(&quot;Purchase&quot;, {"{ amount: 99 }"})</code> and{" "}
        <code>crma.identify(&quot;user@example.com&quot;)</code> from your site.
      </p>
    </div>
  );
}
