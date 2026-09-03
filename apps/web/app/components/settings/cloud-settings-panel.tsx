"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Loader2 } from "lucide-react";
import { ChatModelSelector, type ChatModelSelectorOption } from "../chat-model-selector";
import {
	CHAT_THINKING_LEVELS,
	CHAT_THINKING_LEVEL_HINTS,
	CHAT_THINKING_LEVEL_LABELS,
	DEFAULT_CHAT_THINKING_LEVEL,
	type ChatThinkingLevel,
} from "@/lib/chat-models";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";
import { CrmAIntegrationsSection } from "../integrations/crm-a-integrations-section";
import { McpServersSection } from "./mcp-servers-section";
import type { CrmAIntegrationId, CrmAIntegrationState, IntegrationsState } from "@/lib/integrations";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";


type CatalogModel = {
  id: string;
  stableId: string;
  displayName: string;
  provider: string;
  reasoning: boolean;
};

type VoiceOption = {
  voiceId: string;
  name: string;
  description: string | null;
  category: string | null;
  previewUrl: string | null;
  labels: string[];
};

type CloudStatus = "no_key" | "invalid_key" | "valid";

type CloudState = {

  status: CloudStatus;
  apiKeySource: "config" | "env" | "missing";
  gatewayUrl: string;
  primaryModel: string | null;
  isCrmAPrimary: boolean;
  selectedCrmAModel: string | null;
  selectedThinkingLevel: ChatThinkingLevel;
  selectedVoiceId: string | null;
  elevenLabsEnabled: boolean;
  models: CatalogModel[];
  recommendedModelId: string;
  validationError?: string;
};

type RefreshInfo = {
  attempted: boolean;
  restarted: boolean;
  error: string | null;
  profile: string;
};

type ActionNotice = {
  tone: "success" | "warning" | "error";
  message: string;
};

function isNetworkValidationError(message: string): boolean {
  return message.startsWith("Could not reach Crm-A Cloud gateway");
}

function apiKeySubtitle(validationError?: string): string {
  if (!validationError) {
    return "Connect to Crm-A Cloud for AI model access.";
  }
  if (isNetworkValidationError(validationError)) {
    return "Could not reach Crm-A Cloud. Check your connection and try again.";
  }
  return "Your API key is invalid. Enter a new one below.";
}

type IntegrationDraftState = Record<CrmAIntegrationId, boolean>;

const ENRICHMENT_WATERFALL_PROVIDERS = [
  { id: "crm-a", name: "Crm-A", src: "/crm-a-workspace-icon.png", rounded: true },
  { id: "aviato", name: "Aviato", src: "/integrations/aviato.ico", rounded: true },
  { id: "apollo", name: "Apollo", src: "/integrations/apollo.ico", rounded: true },
  { id: "pdl", name: "People Data Labs", src: "/integrations/people-data-labs.ico", rounded: true },
  { id: "datagma", name: "Datagma", src: "/integrations/datagma.png", rounded: true },
  { id: "rocketreach", name: "RocketReach", src: "/integrations/rocketreach.ico", rounded: true },
  { id: "hunter", name: "Hunter", src: "/integrations/hunter.png", rounded: true },
  { id: "bettercontacts", name: "Better Contacts", src: "/integrations/bettercontacts.png", rounded: true },
  { id: "dropcontacts", name: "Dropcontact", src: "/integrations/dropcontacts.ico", rounded: true },
  { id: "explorium", name: "Explorium", src: "/integrations/explorium.png", rounded: true },
] as const;

const CRM_A_API_KEY_URL = "https://dench.com/api";

/** Sentinel for “default voice” in radio group (empty string is avoided for Radix value). */
const DEFAULT_VOICE_RADIO_VALUE = "__crm_a_default_voice__";
const SUBTLE_PICKER_TRIGGER_CLASS =
  "w-full max-w-full rounded-xl border border-[color-mix(in_srgb,var(--color-border)_78%,transparent)] bg-[var(--color-surface)] px-3 py-2.5 hover:opacity-100";

function buildIntegrationDraft(state: IntegrationsState | null): IntegrationDraftState {
  const enabled = new Map<CrmAIntegrationId, boolean>();
  for (const integration of state?.integrations ?? []) {
    enabled.set(integration.id, integration.enabled);
  }
  return {
    exa: enabled.get("exa") ?? false,
    apollo: enabled.get("apollo") ?? false,
    elevenlabs: enabled.get("elevenlabs") ?? false,
  };
}

function applyIntegrationDraft(
  state: IntegrationsState,
  draft: IntegrationDraftState,
  draftIsCrmAPrimary: boolean,
): IntegrationsState {
  return {
    ...state,
    crmACloud: {
      ...state.crmACloud,
      isPrimaryProvider: draftIsCrmAPrimary,
      primaryModel: state.crmACloud.primaryModel,
    },
    integrations: state.integrations.map((integration) => {
      if (integration.lockReason !== "crm_a_not_primary") {
        return {
          ...integration,
          enabled: draft[integration.id],
        };
      }

      if (draftIsCrmAPrimary) {
        return {
          ...integration,
          enabled: draft[integration.id],
          locked: false,
          lockReason: null,
          lockBadge: null,
          available: integration.auth.configured && Boolean(integration.gatewayBaseUrl),
        };
      }

      return {
        ...integration,
        enabled: draft[integration.id],
        locked: true,
        lockReason: "crm_a_not_primary",
        lockBadge: "Use Crm-A Cloud",
        available: false,
      };
    }),
  };
}

function NoticeBanner({ notice }: { notice: ActionNotice }) {
  const toneClass =
    notice.tone === "success"
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
      : notice.tone === "warning"
        ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
        : "border-red-500/30 bg-red-500/10 text-red-300";

  return (
    <div className={`rounded-xl border px-4 py-3 text-sm ${toneClass}`}>
      {notice.message}
    </div>
  );
}

function EnrichmentWaterfallCard({
  enrichmentIntegration,
  onToggleEnrichment,
}: {
  enrichmentIntegration: CrmAIntegrationState | null;
  onToggleEnrichment: (integration: CrmAIntegrationState, enabled: boolean) => void;
}) {
  const enrichmentLabel = "Crm-A Enrichments";

  return (
    <div
      className="rounded-xl border px-4 py-4"
      style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="text-sm font-medium" style={{ color: "var(--color-text)" }}>
            Crm-A Enrichment
          </div>
          <div className="max-w-[42rem] text-xs leading-5" style={{ color: "var(--color-text-muted)" }}>
            Enrich people and company data with multiple providers.
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {enrichmentIntegration?.lockBadge ? (
            <span
              className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium"
              style={{
                background: "var(--color-surface-hover)",
                color: "var(--color-text)",
              }}
            >
              {enrichmentIntegration.lockBadge}
            </span>
          ) : null}
          <Switch
            aria-label={`Toggle ${enrichmentLabel}`}
            checked={enrichmentIntegration?.enabled ?? false}
            disabled={
              !enrichmentIntegration
              || enrichmentIntegration.locked
            }
            onCheckedChange={(checked) => {
              if (enrichmentIntegration) {
                onToggleEnrichment(enrichmentIntegration, checked);
              }
            }}
          />
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        {ENRICHMENT_WATERFALL_PROVIDERS.map((provider) => (
          <div
            key={provider.id}
            className="flex h-8 w-8 items-center justify-center"
            title={provider.name}
            aria-label={provider.name}
          >
            <img
              src={provider.src}
              alt=""
              width={24}
              height={24}
              className={provider.rounded ? "h-6 w-6 rounded-[6px] object-contain" : "h-6 w-6 object-contain"}
              draggable={false}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function CloudIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
    </svg>
  );
}

function KeyIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4" />
      <path d="m21 2-9.6 9.6" />
      <circle cx="7.5" cy="15.5" r="5.5" />
    </svg>
  );
}

function ExternalLinkIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </svg>
  );
}

function ApiKeyEntry({
  onSave,
  saving,
  notice,
  validationError,
}: {
  onSave: (key: string) => void;
  saving: boolean;
  notice: ActionNotice | null;
  validationError?: string;
}) {
  const [keyInput, setKeyInput] = useState("");
  const showValidationBanner =
    Boolean(validationError) && (!notice || notice.message !== validationError);

  return (
    <div className="space-y-4">
      <div
        className="flex items-center gap-3 rounded-xl border px-4 py-3"
        style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
      >
        <div
          className="flex h-9 w-9 items-center justify-center rounded-lg shrink-0"
          style={{ background: "var(--color-surface-hover)", color: "var(--color-text)" }}
        >
          <CloudIcon />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium" style={{ color: "var(--color-text)" }}>
            Crm-A Cloud
          </div>
          <div className="text-[11px] mt-0.5" style={{ color: "var(--color-text-muted)" }}>
            {apiKeySubtitle(validationError)}
          </div>
        </div>
        <a
          href={CRM_A_API_KEY_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors hover:bg-stone-200 dark:hover:bg-stone-700"
          style={{ color: "var(--color-accent)" }}
        >
          Get API Key <ExternalLinkIcon />
        </a>
      </div>

      {showValidationBanner && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {validationError}
        </div>
      )}

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <span
            className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
            style={{ color: "var(--color-text-muted)" }}
          >
            <KeyIcon />
          </span>
          <input
            type="password"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && keyInput.trim() && !saving) {
                onSave(keyInput.trim());
              }
            }}
            placeholder="Paste your Crm-A API key..."
            className="w-full pl-9 pr-3 py-2.5 rounded-xl text-sm outline-none transition-colors"
            style={{
              background: "var(--color-surface)",
              border: "1px solid var(--color-border)",
              color: "var(--color-text)",
            }}
            disabled={saving}
          />
        </div>
        <Button
          type="button"
          onClick={() => { if (keyInput.trim()) onSave(keyInput.trim()); }}
          disabled={!keyInput.trim() || saving}
        >
          {saving ? "Validating..." : "Save"}
        </Button>
      </div>

      {notice && <NoticeBanner notice={notice} />}
    </div>
  );
}

function ModelSelector({
  models,
  selectedModel,
  selectedThinkingLevel,
  selectedVoiceId,
  elevenLabsEnabled,
  isCrmAPrimary,
  recommendedModelId,
  onSelect,
  onSelectThinkingLevel,
  onSelectVoice,
  selecting,
  savingVoice,
  voiceLoading,
  voices,
}: {
  models: CatalogModel[];
  selectedModel: string | null;
  selectedThinkingLevel: ChatThinkingLevel;
  selectedVoiceId: string | null;
  elevenLabsEnabled: boolean;
  isCrmAPrimary: boolean;
  recommendedModelId: string;
  onSelect: (stableId: string) => void;
  onSelectThinkingLevel: (level: ChatThinkingLevel) => void;
  onSelectVoice: (voiceId: string | null) => void;
  selecting: boolean;
  savingVoice: boolean;
  voiceLoading: boolean;
  voices: VoiceOption[];
}) {
  const pickerModels: ChatModelSelectorOption[] = models.map((model) => ({
    stableId: model.stableId,
    ...(model.id.trim() && model.id !== model.stableId
      ? { catalogId: model.id }
      : {}),
    displayName: model.displayName,
    provider: model.provider,
    reasoning: model.reasoning,
    isRecommended: model.id === recommendedModelId,
  }));
  const selectedVoice = voices.find((voice) => voice.voiceId === selectedVoiceId) ?? null;

  return (
    <div className="space-y-4">
      <div
        className="flex items-center gap-3 rounded-xl border px-4 py-3"
        style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
      >
        <img
          src="/crm-a-workspace-icon.png"
          alt=""
          width={36}
          height={36}
          className="h-9 w-9 shrink-0 rounded-lg object-contain"
          draggable={false}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium" style={{ color: "var(--color-text)" }}>
              Crm-A Cloud
            </span>
            <span
              className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium"
              style={{
                background: isCrmAPrimary ? "rgba(16,185,129,0.15)" : "var(--color-surface-hover)",
                color: isCrmAPrimary ? "rgb(16,185,129)" : "var(--color-text-muted)",
              }}
            >
              {isCrmAPrimary ? "Active" : "Available"}
            </span>
          </div>
          <div className="text-[11px] mt-0.5" style={{ color: "var(--color-text-muted)" }}>
            {isCrmAPrimary
              ? "Connected and active as your primary provider."
              : "Connected. Select a model to use Crm-A Cloud as your primary provider."}
          </div>
        </div>
        <a
          href="https://dench.com/usage"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-xs font-medium shrink-0 transition-opacity hover:opacity-80"
          style={{ color: "var(--color-accent)" }}
        >
          Usage <ExternalLinkIcon />
        </a>
      </div>

      <div>
        <label
          className="block text-xs font-medium mb-2"
          style={{ color: "var(--color-text-muted)" }}
        >
          Primary Model
        </label>
        <div className="max-w-[420px]">
          <ChatModelSelector
            models={pickerModels}
            selectedModel={isCrmAPrimary ? selectedModel : null}
            onSelect={onSelect}
            disabled={selecting}
            loading={selecting}
            fallbackToFirst={isCrmAPrimary}
            placeholder="Choose a model..."
            ariaLabel="Select primary model"
            triggerClassName={SUBTLE_PICKER_TRIGGER_CLASS}
          />
        </div>
      </div>

      <div>
        <label
          className="block text-xs font-medium mb-2"
          style={{ color: "var(--color-text-muted)" }}
        >
          Thinking Level
        </label>
        <div className="max-w-[420px]">
          <DropdownMenu>
            <DropdownMenuTrigger
              className={`inline-flex items-center gap-1.5 text-sm font-medium transition-opacity disabled:cursor-default disabled:opacity-60 cursor-pointer outline-none ring-0 ${SUBTLE_PICKER_TRIGGER_CLASS}`}
              style={{ color: "var(--color-text-secondary)", opacity: 0.9 }}
              aria-label="Select thinking level"
              disabled={selecting}
            >
              <span>{CHAT_THINKING_LEVEL_LABELS[selectedThinkingLevel]}</span>
              <ChevronDown className="h-4 w-4 shrink-0 opacity-60" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-[220px]">
              <DropdownMenuRadioGroup
                value={selectedThinkingLevel}
                onValueChange={(value) => onSelectThinkingLevel(value as ChatThinkingLevel)}
              >
                {CHAT_THINKING_LEVELS.map((level) => (
                  <DropdownMenuRadioItem key={level} value={level}>
                    <span className="flex flex-col">
                      <span className="text-sm">{CHAT_THINKING_LEVEL_LABELS[level]}</span>
                      <span className="text-[11px]" style={{ color: "var(--color-text-muted)" }}>
                        {CHAT_THINKING_LEVEL_HINTS[level]}
                      </span>
                    </span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div>
        <label
          className="block text-xs font-medium mb-2"
          style={{ color: "var(--color-text-muted)" }}
        >
          ElevenLabs Voice
        </label>
        <div className="max-w-[420px]">
          <DropdownMenu>
            <DropdownMenuTrigger
              className={`inline-flex items-center gap-1.5 text-sm font-medium transition-opacity disabled:cursor-default disabled:opacity-60 cursor-pointer outline-none ring-0 ${SUBTLE_PICKER_TRIGGER_CLASS}`}
              style={{
                color: "var(--color-text-secondary)",
                opacity: 0.9,
              }}
              aria-label="Select ElevenLabs voice"
              title={selectedVoice?.name ?? undefined}
              disabled={voiceLoading || savingVoice || voices.length === 0}
            >
              <span
                className="max-w-[240px] truncate"
                style={
                  voiceLoading || (!selectedVoice && voices.length === 0)
                    ? { color: "var(--color-text-muted)" }
                    : undefined
                }
              >
                {voiceLoading
                  ? "Loading voices..."
                  : voices.length === 0
                    ? "No voices available"
                    : selectedVoice
                      ? `${selectedVoice.name}${selectedVoice.category ? ` · ${selectedVoice.category}` : ""}`
                      : "Default voice (first available)"}
              </span>
              {voiceLoading || savingVoice ? (
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
              ) : (
                <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden />
              )}
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              side="bottom"
              sideOffset={8}
              className="min-w-[15rem] max-w-[20rem] p-1.5"
            >
              <DropdownMenuRadioGroup
                value={selectedVoiceId ?? DEFAULT_VOICE_RADIO_VALUE}
                onValueChange={(value) => {
                  onSelectVoice(
                    value === DEFAULT_VOICE_RADIO_VALUE ? null : value,
                  );
                }}
              >
                <DropdownMenuRadioItem value={DEFAULT_VOICE_RADIO_VALUE}>
                  Default voice (first available)
                </DropdownMenuRadioItem>
                {voices.map((voice) => (
                  <DropdownMenuRadioItem key={voice.voiceId} value={voice.voiceId}>
                    <span className="truncate">
                      {voice.name}
                      {voice.category ? ` · ${voice.category}` : ""}
                    </span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="mt-2 space-y-1">
          <p className="text-[11px]" style={{ color: "var(--color-text-muted)" }}>
            {elevenLabsEnabled
              ? "Used for message playback and server-side voice input."
              : "Choose a voice now. Playback and server-side voice input stay off until ElevenLabs is enabled in Integrations."}
          </p>
          {selectedVoice?.description && (
            <p className="text-[11px]" style={{ color: "var(--color-text-muted)" }}>
              {selectedVoice.description}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export function CloudSettingsPanel() {
  const [data, setData] = useState<CloudState | null>(null);
  const [integrationsData, setIntegrationsData] = useState<IntegrationsState | null>(null);
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [integrationsLoading, setIntegrationsLoading] = useState(false);
  const [voiceLoading, setVoiceLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [integrationsError, setIntegrationsError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savingActive, setSavingActive] = useState(false);
  const [repairingIntegrations, setRepairingIntegrations] = useState(false);
  const [notice, setNotice] = useState<ActionNotice | null>(null);
  const [draftModel, setDraftModel] = useState<string | null>(null);
  const [draftVoiceId, setDraftVoiceId] = useState<string | null>(null);
  const [draftIntegrations, setDraftIntegrations] = useState<IntegrationDraftState>({
    exa: false,
    apollo: false,
    elevenlabs: false,
  });
  const [draftThinkingLevel, setDraftThinkingLevel] = useState<ChatThinkingLevel>(DEFAULT_CHAT_THINKING_LEVEL);
  const [draftResetKey, setDraftResetKey] = useState(0);

  const fetchState = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/cloud");
      if (!res.ok) throw new Error(`Failed to load cloud settings (${res.status})`);
      const payload = (await res.json()) as CloudState;
      setData(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load cloud settings.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchState();
  }, [fetchState]);

  const fetchIntegrations = useCallback(async () => {
    setIntegrationsLoading(true);
    setIntegrationsError(null);
    try {
      const response = await fetch("/api/integrations");
      if (!response.ok) {
        throw new Error(`Failed to load integrations (${response.status})`);
      }
      const payload = (await response.json()) as IntegrationsState;
      setIntegrationsData(payload);
    } catch (err) {
      setIntegrationsError(err instanceof Error ? err.message : "Failed to load integrations.");
    } finally {
      setIntegrationsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (data?.status !== "valid") {
      setIntegrationsData(null);
      setIntegrationsError(null);
      setIntegrationsLoading(false);
      return;
    }
    void (async () => {
      await fetchIntegrations();
      setDraftResetKey((current) => current + 1);
    })();
  }, [data?.status, fetchIntegrations]);

  useEffect(() => {
    if (data?.status !== "valid") {
      setVoices([]);
      return;
    }

    let cancelled = false;
    setVoiceLoading(true);

    void (async () => {
      try {
        const response = await fetch("/api/voice/voices");
        if (!response.ok) {
          if (!cancelled) {
            setVoices([]);
          }
          return;
        }
        const payload = await response.json() as { voices?: VoiceOption[] };
        if (!cancelled) {
          setVoices(Array.isArray(payload.voices) ? payload.voices : []);
        }
      } catch {
        if (!cancelled) {
          setVoices([]);
        }
      } finally {
        if (!cancelled) {
          setVoiceLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [data?.status, data?.gatewayUrl]);

  const integrationsDataRef = useRef(integrationsData);
  integrationsDataRef.current = integrationsData;

  useEffect(() => {
    if (data?.status !== "valid" || !integrationsDataRef.current) {
      return;
    }
    setDraftModel(data.isCrmAPrimary ? data.selectedCrmAModel : null);
    setDraftVoiceId(data.selectedVoiceId);
    setDraftThinkingLevel(data.selectedThinkingLevel);
    setDraftIntegrations(buildIntegrationDraft(integrationsDataRef.current));
  }, [
    data?.status,
    data?.isCrmAPrimary,
    data?.selectedCrmAModel,
    data?.selectedVoiceId,
    data?.selectedThinkingLevel,
    draftResetKey,
  ]);

  const handleSaveKey = useCallback(async (apiKey: string) => {
    setSaving(true);
    setNotice(null);
    try {
      const res = await fetch("/api/settings/cloud", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save_key", apiKey }),
      });
      const payload = await res.json();
      if (!res.ok) {
        if (payload.state) {
          setData(payload.state);
        }
        setNotice({
          tone: "error",
          message: payload.error ?? "Failed to save API key.",
        });
        return;
      }
      setData(payload.state);
      const refresh = payload.refresh as RefreshInfo;
      if (refresh.restarted) {
        setNotice({
          tone: "success",
          message: `API key saved and the ${refresh.profile} gateway restarted successfully.`,
        });
      } else if (refresh.attempted) {
        setNotice({
          tone: "warning",
          message: `API key saved, but the gateway restart did not complete: ${refresh.error ?? "unknown error"}.`,
        });
      } else {
        setNotice({ tone: "success", message: "API key saved successfully." });
      }
    } catch (err) {
      setNotice({
        tone: "error",
        message: err instanceof Error ? err.message : "Failed to save API key.",
      });
    } finally {
      setSaving(false);
    }
  }, []);

  const handleDraftModelChange = useCallback((stableId: string) => {
    setNotice(null);
    setDraftModel(stableId);
  }, []);

  const handleDraftVoiceChange = useCallback((voiceId: string | null) => {
    setNotice(null);
    setDraftVoiceId(voiceId);
  }, []);

  const handleDraftThinkingLevelChange = useCallback((level: ChatThinkingLevel) => {
    setNotice(null);
    setDraftThinkingLevel(level);
  }, []);

  const handleDraftIntegrationToggle = useCallback((integration: CrmAIntegrationState, enabled: boolean) => {
    setNotice(null);
    setDraftIntegrations((current) => ({
      ...current,
      [integration.id]: enabled,
    }));
  }, []);

  const resetDraft = useCallback(() => {
    if (data?.status !== "valid" || !integrationsData) {
      return;
    }
    setNotice(null);
    setDraftModel(data.isCrmAPrimary ? data.selectedCrmAModel : null);
    setDraftVoiceId(data.selectedVoiceId);
    setDraftThinkingLevel(data.selectedThinkingLevel);
    setDraftIntegrations(buildIntegrationDraft(integrationsData));
  }, [data, integrationsData]);

  const baselineModel = data?.status === "valid" && data.isCrmAPrimary ? data.selectedCrmAModel : null;
  const baselineVoiceId = data?.status === "valid" ? data.selectedVoiceId : null;
  const baselineThinkingLevel = data?.status === "valid" ? data.selectedThinkingLevel : null;
  const baselineIntegrations = useMemo(
    () => buildIntegrationDraft(integrationsData),
    [integrationsData],
  );
  const hasUnsavedChanges = Boolean(data?.status === "valid" && (
    draftModel !== baselineModel
    || draftVoiceId !== baselineVoiceId
    || draftThinkingLevel !== baselineThinkingLevel
    || draftIntegrations.exa !== baselineIntegrations.exa
    || draftIntegrations.apollo !== baselineIntegrations.apollo
    || draftIntegrations.elevenlabs !== baselineIntegrations.elevenlabs
  ));
  const draftIsCrmAPrimary = Boolean(draftModel);
  const draftIntegrationsState = useMemo(() => {
    if (!integrationsData) {
      return null;
    }
    return applyIntegrationDraft(integrationsData, draftIntegrations, draftIsCrmAPrimary);
  }, [draftIntegrations, draftIsCrmAPrimary, integrationsData]);

  const handleSaveActiveSettings = useCallback(async () => {
    setSavingActive(true);
    setNotice(null);
    try {
      const res = await fetch("/api/settings/cloud", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save_active_settings",
          stableId: draftModel,
          voiceId: draftVoiceId,
          thinkingLevel: draftThinkingLevel,
          integrations: draftIntegrations,
        }),
      });
      const payload = await res.json();
      if (!res.ok) {
        setNotice({
          tone: "error",
          message: payload.error ?? "Failed to save cloud settings.",
        });
        return;
      }
      setData(payload.state);
      if (payload.integrationsState) {
        setIntegrationsData(payload.integrationsState as IntegrationsState);
        setDraftResetKey((current) => current + 1);
      } else {
        void (async () => {
          await fetchIntegrations();
          setDraftResetKey((current) => current + 1);
        })();
      }
      const refresh = payload.refresh as RefreshInfo;
      if (!payload.changed) {
        setNotice({ tone: "success", message: "No changes to save." });
      } else if (refresh.restarted) {
        setNotice({
          tone: "success",
          message: `Cloud settings saved and the ${refresh.profile} gateway restarted successfully.`,
        });
      } else if (refresh.attempted) {
        setNotice({
          tone: "warning",
          message: `Cloud settings saved, but the gateway restart did not complete: ${refresh.error ?? "unknown error"}.`,
        });
      } else {
        setNotice({ tone: "success", message: "Cloud settings saved successfully." });
      }
    } catch (err) {
      setNotice({
        tone: "error",
        message: err instanceof Error ? err.message : "Failed to save cloud settings.",
      });
    } finally {
      setSavingActive(false);
    }
  }, [draftIntegrations, draftModel, draftThinkingLevel, draftVoiceId, fetchIntegrations]);

  const handleRepairIntegrations = useCallback(async () => {
    setRepairingIntegrations(true);
    setNotice(null);
    try {
      const response = await fetch("/api/integrations/repair", {
        method: "POST",
      });
      const payload = await response.json() as {
        changed: boolean;
        repairedIds: string[];
        refresh: RefreshInfo;
      } & IntegrationsState & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to repair integrations.");
      }

      setIntegrationsData(payload);
      setDraftResetKey((current) => current + 1);
      if (payload.changed && payload.refresh.restarted) {
        const repairedNames = payload.repairedIds.length > 0 ? payload.repairedIds.join(", ") : "profiles";
        setNotice({
          tone: "success",
          message: `Repair completed for ${repairedNames} and the ${payload.refresh.profile} gateway restarted successfully.`,
        });
      } else if (payload.changed) {
        setNotice({
          tone: "warning",
          message: `Repair updated the profile, but the gateway restart did not complete: ${payload.refresh.error ?? "unknown error"}.`,
        });
      } else {
        setNotice({
          tone: "success",
          message: "No repair changes were needed for this profile.",
        });
      }
    } catch (err) {
      setNotice({
        tone: "error",
        message: err instanceof Error ? err.message : "Failed to repair integrations.",
      });
    } finally {
      setRepairingIntegrations(false);
    }
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div
          className="h-6 w-6 animate-spin rounded-full border-2"
          style={{ borderColor: "var(--color-border)", borderTopColor: "var(--color-accent)" }}
        />
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="rounded-xl border px-4 py-6 text-center"
        style={{ borderColor: "var(--color-border)" }}
      >
        <p className="text-sm mb-3" style={{ color: "var(--color-text-muted)" }}>
          {error}
        </p>
        <Button type="button" variant="outline" onClick={() => void fetchState()}>
          Retry
        </Button>
      </div>
    );
  }

  if (!data) return null;

  if (data.status === "no_key" || data.status === "invalid_key") {
    return (
      <div className="space-y-8">
        <ApiKeyEntry
          onSave={handleSaveKey}
          saving={saving}
          notice={notice}
          validationError={data.status === "invalid_key" ? data.validationError : undefined}
        />
        <div>
          <h2 className="text-sm font-medium mb-3" style={{ color: "var(--color-text)" }}>Integrations</h2>
          <CrmAIntegrationsSection />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <ModelSelector
        models={data.models}
        selectedModel={draftModel}
        isCrmAPrimary={draftIsCrmAPrimary}
        recommendedModelId={data.recommendedModelId}
        selectedThinkingLevel={draftThinkingLevel}
        selectedVoiceId={draftVoiceId}
        elevenLabsEnabled={draftIntegrations.elevenlabs}
        onSelect={handleDraftModelChange}
        onSelectThinkingLevel={handleDraftThinkingLevelChange}
        onSelectVoice={handleDraftVoiceChange}
        selecting={savingActive}
        savingVoice={savingActive}
        voiceLoading={voiceLoading}
        voices={voices}
      />
      <div>
        <h2 className="text-sm font-medium mb-3" style={{ color: "var(--color-text)" }}>Integrations</h2>
        <CrmAIntegrationsSection
          data={draftIntegrationsState}
          loading={integrationsLoading}
          error={integrationsError}
          savingId={null}
          repairing={repairingIntegrations}
          excludeIntegrationIds={["apollo"]}
          onToggle={handleDraftIntegrationToggle}
          onRetry={() => void fetchIntegrations()}
          onRepair={() => void handleRepairIntegrations()}
        />
      </div>
      <EnrichmentWaterfallCard
        enrichmentIntegration={
          draftIntegrationsState?.integrations.find((i) => i.id === "apollo") ?? null
        }
        onToggleEnrichment={handleDraftIntegrationToggle}
      />
      <McpServersSection />
      <div className="flex items-center justify-end gap-2 pt-2">
        <Button
          type="button"
          variant="ghost"
          className="shrink-0 rounded-lg px-4 text-sm font-medium"
          style={{
            color: "var(--color-text-muted)",
            background: "transparent",
          }}
          onClick={resetDraft}
          disabled={!hasUnsavedChanges || savingActive}
        >
          Reset
        </Button>
        <Button
          type="button"
          className="min-w-28 shrink-0 rounded-lg px-5 text-sm font-semibold"
          style={{
            background: "var(--color-accent)",
            color: "var(--color-bg)",
          }}
          onClick={() => void handleSaveActiveSettings()}
          disabled={!hasUnsavedChanges || savingActive || integrationsLoading || Boolean(integrationsError)}
        >
          <span className="inline-flex items-center justify-center gap-2 leading-none">
            {savingActive ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            <span>{savingActive ? "Saving..." : "Save"}</span>
          </span>
        </Button>
      </div>
    </div>
  );
}
