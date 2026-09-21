"use client";

import { useCallback, useEffect, useState } from "react";
import { RichBodyEditor } from "./rich-body-editor";
import { CrmEmptyState, CrmListShell, CrmLoadingState } from "../crm-list-shell";

/**
 * Campagne section (CDP email marketing): create campaigns targeting a
 * segment, preview the emailable audience, and send through the connected
 * Gmail account.
 */

type CampaignRow = {
  entry_id: string;
  Name?: string | null;
  Subject?: string | null;
  Body?: string | null;
  Segment?: string | null;
  Status?: string | null;
  "Sent At"?: string | null;
  "Recipients Count"?: string | null;
  /** Email (SES) or Phone (NLPearl) — the same card, two channels. */
  Channel?: string | null;
  // Phone channel fields (NLPearl).
  "Nlpearl Pearl ID"?: string | null;
  "Nlpearl Phone ID"?: string | null;
  "Calling Window Start"?: string | null;
  "Calling Window End"?: string | null;
  "Calling Timezone"?: string | null;
  "Calling Days"?: string | null;
  "Voice Brief"?: string | null;
};

type SegmentOption = { entry_id: string; name: string };

const STATUS_COLORS: Record<string, string> = {
  Draft: "#94a3b8",
  Sending: "#3b82f6",
  Paused: "#f59e0b",
  Sent: "#22c55e",
  Cancelled: "#ef4444",
};

const inputStyle = {
  background: "var(--color-surface)",
  color: "var(--color-text)",
  border: "1px solid var(--color-border)",
} as const;

function isPhoneChannel(channel: string | null | undefined): boolean {
  return (channel ?? "").trim().toLowerCase() === "phone";
}

function isPhoneCampaign(row: CampaignRow): boolean {
  return isPhoneChannel(row.Channel);
}

/** Email vs Phone, so a card never reads as the wrong channel. */
function ChannelBadge({ channel }: { channel: string | null | undefined }) {
  const phone = isPhoneChannel(channel);
  const color = phone ? "#22c55e" : "#6366f1";
  return (
    <span
      className="rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={{ background: `${color}22`, color }}
    >
      {phone ? "Phone" : "Email"}
    </span>
  );
}

/** One-line phone configuration summary (what the campaign actually dials with). */
function phoneSummary(row: CampaignRow): string {
  const parts = [
    row["Nlpearl Phone ID"] ? `da ${row["Nlpearl Phone ID"]}` : "numero da impostare",
    row["Calling Window Start"] && row["Calling Window End"]
      ? `${row["Calling Window Start"]}–${row["Calling Window End"]} ${row["Calling Timezone"] ?? ""}`.trim()
      : null,
    row["Nlpearl Pearl ID"] ? "Pearl pronta" : "Pearl da creare",
  ].filter(Boolean);
  return parts.join(" · ");
}

function StatusBadge({ status }: { status: string | null | undefined }) {
  const value = status ?? "Draft";
  return (
    <span
      className="rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={{
        background: `${STATUS_COLORS[value] ?? "#94a3b8"}22`,
        color: STATUS_COLORS[value] ?? "#94a3b8",
      }}
    >
      {value}
    </span>
  );
}

export function CampaignsView() {
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<CampaignRow | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/workspace/objects/campaign?limit=100", { cache: "no-store" });
      if (!res.ok) {throw new Error(`HTTP ${res.status}`);}
      const data = (await res.json()) as { entries?: CampaignRow[] };
      setCampaigns(data.entries ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load campaigns.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleDelete = async (row: CampaignRow) => {
    try {
      await fetch(`/api/crm/campaigns/${encodeURIComponent(row.entry_id)}`, {
        method: "DELETE",
      });
      await load();
    } catch { /* keep list stale */ }
  };

  const handleSend = async (row: CampaignRow) => {
    setSendingId(row.entry_id);
    setNotice(null);
    try {
      const res = await fetch(`/api/crm/campaigns/${encodeURIComponent(row.entry_id)}/send`, {
        method: "POST",
      });
      const data = (await res.json()) as { queued?: number; error?: string };
      if (!res.ok) {throw new Error(data.error ?? `HTTP ${res.status}`);}
      setNotice(`"${row.Name ?? "Campaign"}" queued for ${data.queued} recipients — sending in progress.`);
      await load();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Send failed.");
    } finally {
      setSendingId(null);
    }
  };

  /** Phone channel: enqueue the compliant audience as NLPearl leads. */
  const handlePhoneSend = async (row: CampaignRow) => {
    setSendingId(row.entry_id);
    setNotice(null);
    try {
      const res = await fetch(`/api/crm/campaigns/${encodeURIComponent(row.entry_id)}/phone`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "send" }),
      });
      const data = (await res.json()) as { leadsCreated?: number; errors?: string[]; error?: string };
      if (!res.ok) {throw new Error(data.error ?? `HTTP ${res.status}`);}
      setNotice(
        `"${row.Name ?? "Campagna"}" — ${data.leadsCreated ?? 0} lead inviati a NLPearl` +
          (data.errors?.length ? ` (${data.errors.length} errori)` : "") + ".",
      );
      await load();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Invio fallito.");
    } finally {
      setSendingId(null);
    }
  };

  const handleAction = async (row: CampaignRow, action: "pause" | "resume" | "cancel") => {
    setNotice(null);
    try {
      const res = await fetch(`/api/crm/campaigns/${encodeURIComponent(row.entry_id)}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = (await res.json()) as { status?: string; error?: string };
      if (!res.ok) {throw new Error(data.error ?? `HTTP ${res.status}`);}
      await load();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : `${action} failed.`);
    }
  };

  return (
    <CrmListShell
      title="Campagne"
      count={loading ? null : campaigns.length}
      toolbar={
        <button
          type="button"
          onClick={() => { setEditing(null); setEditorOpen(true); }}
          className="rounded-lg px-4 py-2 text-sm font-medium"
          style={{ background: "var(--color-accent)", color: "#fff" }}
        >
          New campaign
        </button>
      }
    >
      <div className="p-6 space-y-4">
        <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
          Campagne verso i tuoi segmenti: <strong>Email</strong> via AWS SES, <strong>Phone</strong> via NLPearl
          (stessa scheda, canale diverso).
        </p>

      {notice && (
        <div
          className="rounded-xl px-4 py-3 text-sm"
          style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", color: "var(--color-text)" }}
        >
          {notice}
        </div>
      )}
      {error && (
        <div className="rounded-xl px-4 py-3 text-sm" style={{ background: "rgba(239,68,68,0.08)", color: "var(--color-error)" }}>
          {error}
        </div>
      )}

      {loading ? (
        <CrmLoadingState />
      ) : campaigns.length === 0 ? (
        <CrmEmptyState
          title="No campaigns yet"
          description="Create one and target a segment."
        />
      ) : (
        <div className="space-y-2">
          {campaigns.map((row) => (
            <div
              key={row.entry_id}
              className="flex items-center justify-between rounded-xl px-4 py-3"
              style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)" }}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium truncate" style={{ color: "var(--color-text)" }}>
                    {row.Name ?? "Untitled"}
                  </span>
                  <ChannelBadge channel={row.Channel} />
                  <StatusBadge status={row.Status} />
                </div>
                <div className="mt-1 space-y-1 text-[11px]" style={{ color: "var(--color-text-muted)" }}>
                  {isPhoneCampaign(row) ? (
                    <>
                      <div className="truncate">
                        Phone {row["Nlpearl Phone ID"] || "numero da impostare"}
                        {row["Nlpearl Pearl ID"] ? " · Pearl pronta" : " · Pearl da creare"}
                      </div>
                      <div className="truncate">
                        Window {row["Calling Window Start"] || "–"}→{row["Calling Window End"] || "…"} {row["Calling Timezone"] || ""}
                        {row["Calling Days"] ? ` · days ${String(row["Calling Days"]).replace(/[\[\]]/g, "").trim()}` : ""}
                      </div>
                      <div className="truncate">
                        Brief {row["Voice Brief"] ? String(row["Voice Brief"]).slice(0, 180) : "da impostare"}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="truncate">
                        {row.Subject || "No subject"}
                        {row.Status === "Sent" && row["Recipients Count"]
                          ? ` · sent to ${row["Recipients Count"]}`
                          : ""}
                      </div>
                      {row.Body ? (
                        <div className="truncate">{String(row.Body).slice(0, 180)}</div>
                      ) : null}
                    </>
                  )}
                  {row.Segment ? <div className="truncate">Segment: {row.Segment}</div> : null}
                </div>
                {!isPhoneCampaign(row) && row.Status && row.Status !== "Draft" && (
                  <CampaignStatsLine campaignId={row.entry_id} />
                )}
              </div>
              <div className="flex items-center gap-3 shrink-0">
                {isPhoneCampaign(row) && (row.Status === "Draft" || !row.Status || row.Status === "Paused") && (
                  <button
                    type="button"
                    className="text-xs font-medium disabled:opacity-50"
                    style={{ color: "var(--color-accent)" }}
                    disabled={sendingId === row.entry_id}
                    onClick={() => void handlePhoneSend(row)}
                  >
                    {sendingId === row.entry_id ? "Invio…" : row.Status === "Paused" ? "Riprendi" : "Invia lead"}
                  </button>
                )}
                {!isPhoneCampaign(row) && (row.Status === "Draft" || !row.Status) && (
                  <button
                    type="button"
                    className="text-xs font-medium disabled:opacity-50"
                    style={{ color: "var(--color-accent)" }}
                    disabled={sendingId === row.entry_id}
                    onClick={() => void handleSend(row)}
                  >
                    {sendingId === row.entry_id ? "Queuing…" : "Send"}
                  </button>
                )}
                {row.Status === "Sending" && (
                  <>
                    <button
                      type="button"
                      className="text-xs font-medium"
                      style={{ color: "var(--color-accent)" }}
                      onClick={() => void handleAction(row, "pause")}
                    >
                      Pause
                    </button>
                    <button
                      type="button"
                      className="text-xs"
                      style={{ color: "var(--color-error)" }}
                      onClick={() => void handleAction(row, "cancel")}
                    >
                      Cancel
                    </button>
                  </>
                )}
                {row.Status === "Paused" && (
                  <>
                    <button
                      type="button"
                      className="text-xs font-medium"
                      style={{ color: "var(--color-accent)" }}
                      onClick={() => void handleAction(row, "resume")}
                    >
                      Resume
                    </button>
                    <button
                      type="button"
                      className="text-xs"
                      style={{ color: "var(--color-error)" }}
                      onClick={() => void handleAction(row, "cancel")}
                    >
                      Cancel
                    </button>
                  </>
                )}
                {(row.Status === "Draft" || !row.Status || row.Status === "Paused") && (
                  <button
                    type="button"
                    className="text-xs"
                    style={{ color: "var(--color-text-muted)" }}
                    onClick={() => { setEditing(row); setEditorOpen(true); }}
                  >
                    Edit
                  </button>
                )}
                <button
                  type="button"
                  className="text-xs"
                  style={{ color: "var(--color-error)" }}
                  onClick={() => void handleDelete(row)}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editorOpen && (
        <CampaignEditor
          initial={editing}
          onClose={() => { setEditorOpen(false); setEditing(null); }}
          onSaved={() => { setEditorOpen(false); setEditing(null); void load(); }}
        />
      )}
      </div>
    </CrmListShell>
  );
}

/* ─── Live per-campaign send stats ─── */

function CampaignStatsLine({ campaignId }: { campaignId: string }) {
  const [stats, setStats] = useState<{
    queued: number; sent: number; softBounced: number;
    hardBounced: number; complained: number; failed: number; cancelled: number;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`/api/crm/campaigns/${encodeURIComponent(campaignId)}/stats`, {
          cache: "no-store",
        });
        if (!res.ok) {return;}
        const data = await res.json();
        if (!cancelled) {setStats(data);}
      } catch { /* ignore */ }
    };
    void load();
    const interval = setInterval(() => void load(), 15_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [campaignId]);

  if (!stats) {return null;}
  const parts = [
    stats.queued > 0 ? `${stats.queued} queued` : null,
    stats.sent > 0 ? `${stats.sent} sent` : null,
    stats.softBounced > 0 ? `${stats.softBounced} soft bounce` : null,
    stats.hardBounced > 0 ? `${stats.hardBounced} hard bounce` : null,
    stats.complained > 0 ? `${stats.complained} complaints` : null,
    stats.failed > 0 ? `${stats.failed} failed` : null,
    stats.cancelled > 0 ? `${stats.cancelled} cancelled` : null,
  ].filter(Boolean);
  if (parts.length === 0) {return null;}
  return (
    <div className="text-[11px] mt-0.5 tabular-nums" style={{ color: "var(--color-text-muted)" }}>
      {parts.join(" · ")}
    </div>
  );
}

/* ─── Campaign editor ─── */

function CampaignEditor({
  initial,
  onClose,
  onSaved,
}: {
  initial: CampaignRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(initial?.Name ?? "");
  const [subject, setSubject] = useState(initial?.Subject ?? "");
  const [body, setBody] = useState(initial?.Body ?? "");
  const [segmentId, setSegmentId] = useState(initial?.Segment ?? "");
  const [segments, setSegments] = useState<SegmentOption[]>([]);
  const [audience, setAudience] = useState<{ total: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One coherent editor for both channels (the same campaign card in Email or Phone).
  const [channel, setChannel] = useState<"email" | "phone">(
    isPhoneCampaign(initial ?? { entry_id: "" }) ? "phone" : "email",
  );
  const [phoneNumber, setPhoneNumber] = useState(initial?.["Nlpearl Phone ID"] ?? "");
  const [windowStart, setWindowStart] = useState(initial?.["Calling Window Start"] ?? "");
  const [windowEnd, setWindowEnd] = useState(initial?.["Calling Window End"] ?? "");
  const [timezone, setTimezone] = useState(initial?.["Calling Timezone"] ?? "");
  const [daysRaw, setDaysRaw] = useState(initial?.["Calling Days"] ?? "");
  const [brief, setBrief] = useState(initial?.["Voice Brief"] ?? "");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/workspace/objects/segment?limit=100", { cache: "no-store" });
        if (!res.ok) {return;}
        const data = (await res.json()) as { entries?: Array<{ entry_id: string; Name?: string | null }> };
        setSegments(
          (data.entries ?? []).map((e) => ({ entry_id: e.entry_id, name: e.Name ?? "Untitled" })),
        );
      } catch { /* segments optional */ }
    })();
  }, []);

  const previewAudience = useCallback(async () => {
    if (!initial && !segmentId) {return;}
    setError(null);
    try {
      // Audience preview needs a saved campaign id; for unsaved drafts we
      // approximate with the segment compute endpoint is not possible here,
      // so require saving first when editing a new campaign.
      if (!initial) {
        setError("Save the campaign first to preview its audience.");
        return;
      }
      const res = await fetch(`/api/crm/campaigns/${encodeURIComponent(initial.entry_id)}/audience`, {
        cache: "no-store",
      });
      const data = (await res.json()) as { total?: number; error?: string };
      if (!res.ok) {throw new Error(data.error ?? `HTTP ${res.status}`);}
      setAudience({ total: data.total ?? 0 });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Preview failed.");
    }
  }, [initial, segmentId]);

  const handleSave = async () => {
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const segmentName =
        segments.find((seg) => seg.entry_id === segmentId)?.name ?? "";
      if (channel === "phone") {
        // Create the card first (generic entries), then push the phone config.
        let id = initial?.entry_id;
        if (!id) {
          const create = await fetch("/api/workspace/objects/campaign/entries", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              fields: {
                Name: name.trim(),
                Channel: "Phone",
                Segment: segmentId,
                Status: initial?.Status ?? "Draft",
              },
            }),
          });
          if (!create.ok) {throw new Error(`HTTP ${create.status}`);}
          id = ((await create.json()) as { entryId: string }).entryId;
        }
        const res = await fetch(`/api/crm/campaigns/${encodeURIComponent(id)}/phone`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "upsert",
            name: name.trim(),
            phoneNumber: phoneNumber.trim(),
            windowStart: windowStart.trim(),
            windowEnd: windowEnd.trim(),
            timezone: timezone.trim(),
            days: daysRaw.trim()
              ? daysRaw
                  .split(",")
                  .map((d) => Number(d.trim().replace(/[[\]]/g, "")))
                  .filter((n) => Number.isFinite(n))
              : undefined,
            brief: brief,
            segmentName,
          }),
        });
        if (!res.ok) {throw new Error(`HTTP ${res.status}`);}
      } else {
        const fields = {
          Name: name.trim(),
          Subject: subject.trim(),
          Body: body,
          Segment: segmentId,
          Status: initial?.Status ?? "Draft",
        };
        const res = await fetch(
          initial
            ? `/api/workspace/objects/campaign/entries/${encodeURIComponent(initial.entry_id)}`
            : "/api/workspace/objects/campaign/entries",
          {
            method: initial ? "PATCH" : "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fields }),
          },
        );
        if (!res.ok) {throw new Error(`HTTP ${res.status}`);}
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center" style={{ background: "rgba(0,0,0,0.5)" }}>
      <div
        className="relative mt-8 mb-8 w-full max-w-2xl rounded-2xl overflow-hidden shadow-2xl flex flex-col"
        style={{ background: "var(--color-bg)", border: "1px solid var(--color-border)", maxHeight: "calc(100vh - 4rem)" }}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: "var(--color-border)" }}>
          <h2 className="text-lg font-semibold" style={{ color: "var(--color-text)" }}>
            {initial ? "Edit campaign" : "New campaign"}
          </h2>
          <button type="button" onClick={onClose} style={{ color: "var(--color-text-muted)" }}>✕</button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Campaign name"
            className="w-full rounded-lg px-3 py-2 text-sm outline-none"
            style={inputStyle}
          />
          <div className="flex items-center gap-2">
            {(["email", "phone"] as const).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => { setChannel(c); setAudience(null); }}
                className="rounded-full px-3 py-1 text-xs font-medium"
                style={{
                  background: channel === c ? "var(--color-accent)" : "var(--color-surface)",
                  color: channel === c ? "#fff" : "var(--color-text)",
                  border: "1px solid var(--color-border)",
                }}
              >
                {c === "email" ? "Email" : "Phone"}
              </button>
            ))}
          </div>
          <select
            value={segmentId}
            onChange={(e) => { setSegmentId(e.target.value); setAudience(null); }}
            className="w-full rounded-lg px-3 py-2 text-sm outline-none"
            style={inputStyle}
          >
            <option value="">Select a segment…</option>
            {segments.map((s) => (
              <option key={s.entry_id} value={s.entry_id}>{s.name}</option>
            ))}
          </select>
          {channel === "phone" ? (
            <>
              <input
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                placeholder="NLPearl Phone ID o numero (es. +390654547620)"
                className="w-full rounded-lg px-3 py-2 text-sm outline-none"
                style={inputStyle}
              />
              <div className="flex items-center gap-2">
                <input
                  value={windowStart}
                  onChange={(e) => setWindowStart(e.target.value)}
                  placeholder="Inizio (HH:MM)"
                  className="w-full rounded-lg px-2 py-2 text-sm outline-none"
                  style={inputStyle}
                />
                <input
                  value={windowEnd}
                  onChange={(e) => setWindowEnd(e.target.value)}
                  placeholder="Fine (HH:MM)"
                  className="w-full rounded-lg px-2 py-2 text-sm outline-none"
                  style={inputStyle}
                />
              </div>
              <input
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                placeholder="Fuso (es. Europe/Rome)"
                className="w-full rounded-lg px-3 py-2 text-sm outline-none"
                style={inputStyle}
              />
              <input
                value={daysRaw}
                onChange={(e) => setDaysRaw(e.target.value)}
                placeholder="Giorni (1=Mon..7=Sun, es. 1,2,3,4,5)"
                className="w-full rounded-lg px-3 py-2 text-sm outline-none"
                style={inputStyle}
              />
              <textarea
                value={brief}
                onChange={(e) => setBrief(e.target.value)}
                placeholder="Voice Brief (testo che legge la Pearl)"
                rows={4}
                className="w-full rounded-lg px-3 py-2 text-sm outline-none resize-y"
                style={inputStyle}
              />
            </>
          ) : (
            <>
              <input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Email subject"
                className="w-full rounded-lg px-3 py-2 text-sm outline-none"
                style={inputStyle}
              />
              <RichBodyEditor
                value={body}
                onChange={setBody}
                placeholder="Write your email…"
              />
            </>
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void previewAudience()}
              className="rounded-lg px-3 py-2 text-xs font-medium"
              style={{ border: "1px solid var(--color-border)", color: "var(--color-text)" }}
            >
              Preview audience
            </button>
            {audience != null && (
              <span className="text-xs tabular-nums" style={{ color: "var(--color-text-muted)" }}>
                {audience.total} emailable recipients
              </span>
            )}
          </div>
          {error && (
            <div className="rounded-xl px-4 py-3 text-sm" style={{ background: "rgba(239,68,68,0.08)", color: "var(--color-error)" }}>
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t" style={{ borderColor: "var(--color-border)" }}>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm"
            style={{ color: "var(--color-text-muted)", border: "1px solid var(--color-border)" }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            className="rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-60"
            style={{ background: "var(--color-accent)", color: "#fff" }}
          >
            {saving ? "Saving…" : "Save campaign"}
          </button>
        </div>
      </div>
    </div>
  );
}
