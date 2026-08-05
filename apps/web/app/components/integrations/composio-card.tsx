"use client";

import { useEffect, useState } from "react";

/**
 * Composio card (Workspace integrations): manage the direct Composio API
 * key. When set, all Composio traffic (app connections, tool execution)
 * goes straight to Composio's Platform API — no Crm-A Cloud key needed.
 */
export function ComposioCard() {
  const [configured, setConfigured] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/settings/composio", { cache: "no-store" });
        const data = await res.json();
        setConfigured(Boolean(data.configured));
      } catch { /* ignore */ }
      setLoaded(true);
    })();
  }, []);

  const save = async () => {
    setSaving(true);
    setNotice(null);
    try {
      const res = await fetch("/api/settings/composio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey }),
      });
      const data = await res.json();
      if (!res.ok) {throw new Error(data.error ?? `HTTP ${res.status}`);}
      setConfigured(true);
      setApiKey("");
      setNotice("Composio API key saved — app connections now run directly through Composio.");
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setSaving(true);
    try {
      await fetch("/api/settings/composio", { method: "DELETE" });
      setConfigured(false);
      setApiKey("");
      setNotice("Composio API key removed.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="rounded-xl p-4 space-y-3"
      style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)" }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <img src="/logo/composio.webp" alt="" className="h-4 w-auto dark:invert" />
          <h3 className="text-sm font-medium" style={{ color: "var(--color-text)" }}>
            Composio (direct)
          </h3>
        </div>
        {configured && (
          <span className="text-[11px] font-medium" style={{ color: "#22c55e" }}>Configured</span>
        )}
      </div>
      <p className="text-xs leading-relaxed" style={{ color: "var(--color-text-muted)" }}>
        Use your own Composio API key (from platform.composio.dev) so app connections
        and tool execution talk directly to Composio — no Crm-A Cloud key required.
        Takes precedence over the Crm-A Cloud gateway when set.
      </p>
      {loaded && (
        <div className="flex items-center gap-2">
          <input
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            type="password"
            placeholder={configured ? "••••saved — paste a new key to replace" : "Composio API key"}
            className="flex-1 rounded-lg px-3 py-2 text-xs outline-none"
            style={{
              background: "var(--color-background)",
              color: "var(--color-text)",
              border: "1px solid var(--color-border)",
            }}
          />
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || !apiKey.trim()}
            className="shrink-0 rounded-lg px-3 py-2 text-xs font-medium disabled:opacity-50"
            style={{ background: "var(--color-accent)", color: "#fff" }}
          >
            {saving ? "Saving…" : "Save key"}
          </button>
          {configured && (
            <button
              type="button"
              onClick={() => void remove()}
              disabled={saving}
              className="shrink-0 rounded-lg px-3 py-2 text-xs"
              style={{ border: "1px solid var(--color-border)", color: "var(--color-text-muted)" }}
            >
              Remove
            </button>
          )}
        </div>
      )}
      {notice && (
        <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>{notice}</p>
      )}
    </div>
  );
}
