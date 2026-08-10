"use client";

import { useEffect, useState } from "react";

/**
 * NLPearl card (Integrations section): manage the NLPearl phone transport
 * credentials (Account ID + Secret Key from the Integrations UI). Shows the
 * call/lead webhook URLs to configure on the Pearl backend.
 */
export function NlpearlCard() {
  const [configured, setConfigured] = useState(false);
  const [source, setSource] = useState<"env" | "config" | null>(null);
  const [accountId, setAccountId] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [voiceId, setVoiceId] = useState("");
  const [callWebhookUrl, setCallWebhookUrl] = useState<string | null>(null);
  const [leadWebhookUrl, setLeadWebhookUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/settings/nlpearl", { cache: "no-store" });
        const data = await res.json();
        setCallWebhookUrl(data.callWebhookUrl ?? null);
        setLeadWebhookUrl(data.leadWebhookUrl ?? null);
        if (data.configured) {
          setConfigured(true);
          setSource(data.source ?? null);
          setAccountId(data.accountId ?? "");
          setBaseUrl(data.baseUrl ?? "");
          setVoiceId(data.voiceId ?? "");
        }
      } catch { /* ignore */ }
      setLoaded(true);
    })();
  }, []);

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(null), 1500);
    } catch { /* clipboard unavailable */ }
  };

  const save = async () => {
    setSaving(true);
    setNotice(null);
    try {
      const res = await fetch("/api/settings/nlpearl", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId, secretKey, baseUrl, voiceId }),
      });
      if (!res.ok) {
        const payload = (await res.json()) as { error?: string };
        setNotice(payload.error ?? "Failed to save.");
        return;
      }
      setConfigured(true);
      setSource("config");
      setSecretKey("");
      setNotice("Saved.");
    } catch {
      setNotice("Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    await fetch("/api/settings/nlpearl", { method: "DELETE" });
    setConfigured(false);
    setSource(null);
    setAccountId("");
    setSecretKey("");
    setNotice(null);
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
            NLPearl
          </h3>
          <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
            AI phone calls — inbound &amp; outbound Pearls.
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
          <div className="space-y-2">
            <input
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              placeholder="Account ID"
              disabled={source === "env"}
              className="w-full rounded-lg px-3 py-2 text-sm outline-none"
              style={inputStyle}
            />
            <input
              type="password"
              value={secretKey}
              onChange={(e) => setSecretKey(e.target.value)}
              placeholder={secretKey ? "Secret key saved" : "Secret Key"}
              disabled={source === "env"}
              className="w-full rounded-lg px-3 py-2 text-sm outline-none"
              style={inputStyle}
            />
            <input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="Base URL (optional, default https://api.nlpearl.ai/v2)"
              disabled={source === "env"}
              className="w-full rounded-lg px-3 py-2 text-sm outline-none"
              style={inputStyle}
            />
            <input
              value={voiceId}
              onChange={(e) => setVoiceId(e.target.value)}
              placeholder="Voice ID (optional, auto from account)"
              disabled={source === "env"}
              className="w-full rounded-lg px-3 py-2 text-sm outline-none"
              style={inputStyle}
            />
          </div>

          {source === "env" && (
            <p className="mt-2 text-xs" style={{ color: "var(--color-text-muted)" }}>
              Credentials come from the environment (NLPEARL_ACCOUNT_ID /
              NLPEARL_SECRET_KEY) — edit them there.
            </p>
          )}

          {configured && (callWebhookUrl || leadWebhookUrl) && (
            <div className="mt-3 space-y-1.5">
              <p className="text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>
                Pearl webhook URLs
              </p>
              {callWebhookUrl && (
                <WebhookRow
                  label="Call"
                  value={callWebhookUrl}
                  copied={copied === "call"}
                  onCopy={() => void copy(callWebhookUrl, "call")}
                />
              )}
              {leadWebhookUrl && (
                <WebhookRow
                  label="Lead"
                  value={leadWebhookUrl}
                  copied={copied === "lead"}
                  onCopy={() => void copy(leadWebhookUrl, "lead")}
                />
              )}
            </div>
          )}

          {notice && (
            <p className="mt-2 text-xs" style={{ color: "var(--color-text-muted)" }}>{notice}</p>
          )}

          <div className="mt-3 flex items-center gap-2">
            {source !== "env" && (
              <>
                {!configured && (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void save()}
                    className="rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-60"
                    style={{ background: "var(--color-accent)", color: "#fff" }}
                  >
                    {saving ? "Saving…" : "Save"}
                  </button>
                )}
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

function WebhookRow({ label, value, copied, onCopy }: {
  label: string;
  value: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>{label}</span>
      <code
        className="flex-1 truncate rounded-md px-2 py-1 text-[11px]"
        style={{ background: "var(--color-bg)", color: "var(--color-text-muted)" }}
        title={value}
      >
        {value}
      </code>
      <button type="button" onClick={onCopy} className="text-xs" style={{ color: "var(--color-accent)" }}>
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}