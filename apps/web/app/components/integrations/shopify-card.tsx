"use client";

import { useEffect, useState } from "react";

/**
 * Shopify card (Integrations section): manages the e-commerce touchpoint
 * webhook. Shows the webhook URL to configure on the Shopify dev store, the
 * HMAC API secret (from the Integrations UI or env) and the store domain.
 * The webhook itself turns orders into CRM people (see `/api/webhooks/shopify`).
 */
export function ShopifyCard() {
  const [configured, setConfigured] = useState(false);
  const [source, setSource] = useState<"env" | "config" | null>(null);
  const [apiSecret, setApiSecret] = useState("");
  const [storeDomain, setStoreDomain] = useState("");
  const [adminToken, setAdminToken] = useState("");
  const [apiVersion, setApiVersion] = useState("2024-10");
  const [webhookUrl, setWebhookUrl] = useState<string | null>(null);
  const [hmacEnabled, setHmacEnabled] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/settings/shopify", { cache: "no-store" });
        const data = await res.json();
        setWebhookUrl(data.webhookUrl ?? null);
        setHmacEnabled(Boolean(data.hmacEnabled));
        setApiVersion(data.apiVersion ?? "2024-10");
        if (data.configured) {
          setConfigured(true);
          setSource(data.source ?? null);
          setStoreDomain(data.storeDomain ?? "");
          setAdminToken("");
        }
      } catch { /* ignore */ }
      setLoaded(true);
    })();
  }, []);

  const save = async () => {
    setSaving(true);
    setNotice(null);
    try {
      const res = await fetch("/api/settings/shopify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiSecret, storeDomain, adminToken, apiVersion }),
      });
      const payload = (await res.json()) as { error?: string };
      if (!res.ok) {
        setNotice(payload.error ?? "Failed to save.");
        return;
      }
      setConfigured(true);
      setApiSecret("");
      setAdminToken("");
      setHmacEnabled(true);
      setNotice("Saved.");
    } catch {
      setNotice("Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    await fetch("/api/settings/shopify", { method: "DELETE" });
    setConfigured(false);
    setSource(null);
    setApiSecret("");
    setAdminToken("");
    setStoreDomain("");
    setApiVersion("2024-10");
    setNotice(null);
  };

  const copy = async () => {
    if (!webhookUrl) {return;}
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable */ }
  };

  const inputStyle = {
    background: "var(--color-surface)",
    color: "var(--color-text)",
    border: "1px solid var(--color-border)",
  } as const;

  return (
    <div
      className="rounded-xl border p-4"
      style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
    >
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium" style={{ color: "var(--color-text)" }}>
            Shopify
          </h3>
          <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
            E-commerce touchpoint — orders become CRM people.
          </p>
        </div>
        <span
          className="rounded-full px-2 py-0.5 text-[11px] font-medium"
          style={{
            color: configured ? "#22c55e" : "var(--color-text-muted)",
            background: configured ? "rgba(34,197,94,0.1)" : "transparent",
            border: `1px solid ${configured ? "rgba(34,197,94,0.35)" : "var(--color-border)"}`,
          }}
        >
          {configured ? (source === "env" ? "Env" : "Configured") : "Not configured"}
        </span>
      </div>

      {!loaded ? null : (
        <>
          {hmacEnabled && (
            <p className="mb-2 text-xs" style={{ color: "var(--color-text-muted)" }}>
              Webhooks are verified by HMAC signature.
            </p>
          )}

          <div className="space-y-2">
            <input
              value={apiSecret}
              onChange={(e) => setApiSecret(e.target.value)}
              placeholder="Shopify app API secret (webhook HMAC)"
              disabled={source === "env"}
              className="w-full rounded-lg px-3 py-2 text-sm outline-none"
              style={inputStyle}
            />
            <input
              value={storeDomain}
              onChange={(e) => setStoreDomain(e.target.value)}
              placeholder="Store domain (e.g. my-store.myshopify.com)"
              disabled={source === "env"}
              className="w-full rounded-lg px-3 py-2 text-sm outline-none"
              style={inputStyle}
            />
            <input
              type="password"
              value={adminToken}
              onChange={(e) => setAdminToken(e.target.value)}
              placeholder="Admin API token (shpat_…)"
              disabled={source === "env"}
              className="w-full rounded-lg px-3 py-2 text-sm outline-none"
              style={inputStyle}
            />
            <input
              value={apiVersion}
              onChange={(e) => setApiVersion(e.target.value)}
              placeholder="Admin API version (e.g. 2024-10)"
              disabled={source === "env"}
              className="w-full rounded-lg px-3 py-2 text-sm outline-none"
              style={inputStyle}
            />
          </div>

          {source === "env" && (
            <p className="mt-2 text-xs" style={{ color: "var(--color-text-muted)" }}>
              Configured via environment (SHOPIFY_API_SECRET / SHOPIFY_ADMIN_TOKEN) — edit credentials there.
            </p>
          )}

          {webhookUrl && (
            <div className="mt-3 space-y-1.5">
              <p className="text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>
                Webhook URL (configure on the Shopify App → Webhooks)
              </p>
              <div className="flex items-center gap-2">
                <code
                  className="flex-1 truncate rounded-md px-2 py-1 text-[11px]"
                  style={{ background: "var(--color-bg)", color: "var(--color-text-muted)" }}
                  title={webhookUrl}
                >
                  {webhookUrl}
                </code>
                <button type="button" onClick={() => void copy()} className="text-xs" style={{ color: "var(--color-accent)" }}>
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
            </div>
          )}

          {notice && (
            <p className="mt-2 text-xs" style={{ color: "var(--color-text-muted)" }}>{notice}</p>
          )}

          <div className="mt-3 flex items-center gap-2">
            {source !== "env" && (
              <>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void save()}
                  className="rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-60"
                  style={{ background: "var(--color-accent)", color: "#fff" }}
                >
                  {saving ? "Saving…" : "Save"}
                </button>
                {configured && source === "config" && (
                  <button
                    type="button"
                    onClick={() => void remove()}
                    className="rounded-lg px-3 py-1.5 text-sm"
                    style={{ color: "var(--color-error)", border: "1px solid var(--color-border)" }}
                  >
                    Remove
                  </button>
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}