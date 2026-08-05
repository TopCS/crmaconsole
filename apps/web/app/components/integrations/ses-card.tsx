"use client";

import { useEffect, useState } from "react";

/**
 * AWS SES card (Integrations section): manage the SES transport used by
 * Campagne for email sending (region, credentials, sender identity).
 */
export function SesCard() {
  const [configured, setConfigured] = useState(false);
  const [region, setRegion] = useState("");
  const [accessKeyId, setAccessKeyId] = useState("");
  const [secretAccessKey, setSecretAccessKey] = useState("");
  const [fromEmail, setFromEmail] = useState("");
  const [fromName, setFromName] = useState("");
  const [configurationSet, setConfigurationSet] = useState("");
  const [webhookUrl, setWebhookUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/settings/ses", { cache: "no-store" });
        const data = await res.json();
        setWebhookUrl(data.webhookUrl ?? null);
        if (data.configured) {
          setConfigured(true);
          setRegion(data.region ?? "");
          setAccessKeyId(data.accessKeyId ?? "");
          setFromEmail(data.fromEmail ?? "");
          setFromName(data.fromName ?? "");
          setConfigurationSet(data.configurationSet ?? "");
        }
      } catch { /* ignore */ }
      setLoaded(true);
    })();
  }, []);

  const copyWebhook = async () => {
    if (!webhookUrl) {return;}
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable */ }
  };

  const save = async () => {
    setSaving(true);
    setNotice(null);
    try {
      const res = await fetch("/api/settings/ses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          region,
          accessKeyId,
          ...(secretAccessKey ? { secretAccessKey } : {}),
          fromEmail,
          fromName,
          configurationSet,
        }),
      });
      const data = await res.json();
      if (!res.ok) {throw new Error(data.error ?? `HTTP ${res.status}`);}
      setConfigured(true);
      setSecretAccessKey("");
      setNotice("SES configuration saved.");
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setSaving(true);
    try {
      await fetch("/api/settings/ses", { method: "DELETE" });
      setConfigured(false);
      setRegion(""); setAccessKeyId(""); setSecretAccessKey("");
      setFromEmail(""); setFromName(""); setConfigurationSet("");
      setNotice("SES configuration removed.");
    } finally {
      setSaving(false);
    }
  };

  const inputStyle = {
    background: "var(--color-background)",
    color: "var(--color-text)",
    border: "1px solid var(--color-border)",
  } as const;

  return (
    <div
      className="rounded-xl p-4 space-y-3"
      style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)" }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="m3 11 18-5v12L3 14v-3z" />
          </svg>
          <h3 className="text-sm font-medium" style={{ color: "var(--color-text)" }}>
            AWS SES
          </h3>
        </div>
        {configured && (
          <span className="text-[11px] font-medium" style={{ color: "#22c55e" }}>Configured</span>
        )}
      </div>
      <p className="text-xs leading-relaxed" style={{ color: "var(--color-text-muted)" }}>
        Email transport for Campagne. Requires a verified sender identity in AWS.
      </p>
      <div className="space-y-1.5">
        <p className="text-[11px] font-medium uppercase tracking-wider" style={{ color: "var(--color-text-muted)" }}>
          SNS bounce webhook
        </p>
        <div className="flex items-start gap-2">
          <code
            className="flex-1 rounded-lg px-3 py-2 text-[11px] break-all"
            style={{
              background: "var(--color-background)",
              border: "1px solid var(--color-border)",
              color: "var(--color-text)",
            }}
          >
            {webhookUrl ?? "Loading…"}
          </code>
          <button
            type="button"
            onClick={() => void copyWebhook()}
            disabled={!webhookUrl}
            className="shrink-0 rounded-lg px-3 py-2 text-xs font-medium disabled:opacity-50"
            style={{ background: "var(--color-accent)", color: "#fff" }}
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <p className="text-[11px]" style={{ color: "var(--color-text-muted)" }}>
          In AWS: SES configuration set → event publishing → SNS topic → HTTPS subscription
          to this URL. Hard bounces and complaints suppress the person automatically;
          soft bounces are retried (1h/6h/24h).
        </p>
      </div>
      {loaded && (
        <div className="grid grid-cols-2 gap-2">
          <input
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            placeholder="Region (e.g. eu-west-1)"
            className="rounded-lg px-3 py-2 text-xs outline-none"
            style={inputStyle}
          />
          <input
            value={fromEmail}
            onChange={(e) => setFromEmail(e.target.value)}
            placeholder="From email (verified identity)"
            className="rounded-lg px-3 py-2 text-xs outline-none"
            style={inputStyle}
          />
          <input
            value={accessKeyId}
            onChange={(e) => setAccessKeyId(e.target.value)}
            placeholder="Access key ID"
            className="rounded-lg px-3 py-2 text-xs outline-none"
            style={inputStyle}
          />
          <input
            value={secretAccessKey}
            onChange={(e) => setSecretAccessKey(e.target.value)}
            type="password"
            placeholder={configured ? "Secret (••••saved — leave blank to keep)" : "Secret access key"}
            className="rounded-lg px-3 py-2 text-xs outline-none"
            style={inputStyle}
          />
          <input
            value={fromName}
            onChange={(e) => setFromName(e.target.value)}
            placeholder="From name (optional)"
            className="rounded-lg px-3 py-2 text-xs outline-none"
            style={inputStyle}
          />
          <input
            value={configurationSet}
            onChange={(e) => setConfigurationSet(e.target.value)}
            placeholder="Configuration set (optional)"
            className="rounded-lg px-3 py-2 text-xs outline-none"
            style={inputStyle}
          />
        </div>
      )}
      {notice && (
        <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>{notice}</p>
      )}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="rounded-lg px-3 py-2 text-xs font-medium disabled:opacity-50"
          style={{ background: "var(--color-accent)", color: "#fff" }}
        >
          {saving ? "Saving…" : "Save SES config"}
        </button>
        {configured && (
          <button
            type="button"
            onClick={() => void remove()}
            disabled={saving}
            className="rounded-lg px-3 py-2 text-xs"
            style={{ border: "1px solid var(--color-border)", color: "var(--color-text-muted)" }}
          >
            Remove
          </button>
        )}
      </div>
    </div>
  );
}
