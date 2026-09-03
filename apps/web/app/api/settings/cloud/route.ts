import {
  getCloudSettingsState,
  saveActiveCloudSettings,
  saveApiKey,
  saveVoiceId,
  selectModel,
  setChatThinkingLevel,
} from "@/lib/crm-a-cloud-settings";
import { setPrimaryModel, isValidPrimaryModel } from "@/lib/agent-model";
import { refreshIntegrationsRuntime } from "@/lib/integrations";
import { isChatThinkingLevel, type ChatThinkingLevel } from "@/lib/chat-thinking";
import type { CrmAIntegrationId, CrmAIntegrationToggleDraft } from "@/lib/integrations";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const state = await getCloudSettingsState();
    return Response.json(state);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to load cloud settings." },
      { status: 500 },
    );
  }
}
type PostBody = {
  action: "save_key" | "select_model" | "save_voice" | "save_active_settings" | "set_thinking" | "set_primary_model";
  apiKey?: string;
  stableId?: string;
  voiceId?: string | null;
  thinkingLevel?: string;
  model?: string;
  integrations?: CrmAIntegrationToggleDraft;
};

function isSupportedIntegration(id: string): id is CrmAIntegrationId {
  return id === "exa" || id === "apollo" || id === "elevenlabs";
}

export async function POST(request: Request) {
  let body: PostBody;
  try {
    body = (await request.json()) as PostBody;
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (body.action === "save_key") {
    if (typeof body.apiKey !== "string" || !body.apiKey.trim()) {
      return Response.json({ error: "Field 'apiKey' is required." }, { status: 400 });
    }
    try {
      const result = await saveApiKey(body.apiKey.trim());
      if (result.error) {
        return Response.json({ error: result.error, ...result }, { status: 409 });
      }
      return Response.json(result);
    } catch (err) {
      return Response.json(
        { error: err instanceof Error ? err.message : "Failed to save API key." },
        { status: 500 },
      );
    }
  }

  if (body.action === "select_model") {
    if (typeof body.stableId !== "string" || !body.stableId.trim()) {
      return Response.json({ error: "Field 'stableId' is required." }, { status: 400 });
    }
    try {
      const result = await selectModel(body.stableId.trim());
      if (result.error) {
        return Response.json({ error: result.error, ...result }, { status: 409 });
      }
      return Response.json(result);
    } catch (err) {
      return Response.json(
        { error: err instanceof Error ? err.message : "Failed to select model." },
        { status: 500 },
      );
    }
  }

  if (body.action === "save_voice") {
    try {
      const voiceId = typeof body.voiceId === "string"
        ? body.voiceId.trim() || null
        : body.voiceId === null || body.voiceId === undefined
          ? null
          : undefined;
      if (voiceId === undefined) {
        return Response.json({ error: "Field 'voiceId' must be a string or null." }, { status: 400 });
      }
      const result = await saveVoiceId(voiceId);
      if (result.error) {
        return Response.json({ error: result.error, ...result }, { status: 409 });
      }
      return Response.json(result);
    } catch (err) {
      return Response.json(
        { error: err instanceof Error ? err.message : "Failed to save voice." },
        { status: 500 },
      );
    }
  }

  if (body.action === "save_active_settings") {
    try {
      const stableId = typeof body.stableId === "string"
        ? body.stableId.trim() || null
        : body.stableId === undefined
          ? null
          : null;
      const voiceId = typeof body.voiceId === "string"
        ? body.voiceId.trim() || null
        : body.voiceId === null || body.voiceId === undefined
          ? null
          : undefined;
      if (voiceId === undefined) {
        return Response.json({ error: "Field 'voiceId' must be a string or null." }, { status: 400 });
      }
      if (body.integrations !== undefined && (!body.integrations || typeof body.integrations !== "object" || Array.isArray(body.integrations))) {
        return Response.json({ error: "Field 'integrations' must be an object." }, { status: 400 });
      }

      const integrations: CrmAIntegrationToggleDraft = {};
      for (const [id, enabled] of Object.entries(body.integrations ?? {})) {
        if (!isSupportedIntegration(id)) {
          return Response.json({ error: `Unknown integration '${id}'.` }, { status: 400 });
        }
        if (typeof enabled !== "boolean") {
          return Response.json({ error: `Integration '${id}' must be a boolean.` }, { status: 400 });
        }
        integrations[id] = enabled;
      }

      if (body.thinkingLevel !== undefined && body.thinkingLevel !== null && !isChatThinkingLevel(body.thinkingLevel)) {
        return Response.json(
          { error: "Field 'thinkingLevel' must be one of 'off', 'minimal', 'low', 'medium', 'high', 'xhigh'." },
          { status: 400 },
        );
      }
      const validatedThinkingLevel: ChatThinkingLevel | null | undefined =
        body.thinkingLevel === undefined
          ? undefined
          : body.thinkingLevel ?? null;

      const result = await saveActiveCloudSettings({
        stableId,
        voiceId,
        thinkingLevel: validatedThinkingLevel,
        integrations,
      });
      if (result.error) {
        return Response.json({ error: result.error, ...result }, { status: 409 });
      }
      return Response.json(result);
    } catch (err) {
      return Response.json(
        { error: err instanceof Error ? err.message : "Failed to save cloud settings." },
        { status: 500 },
      );
    }
  }

  if (body.action === "set_primary_model") {
    const model = typeof body.model === "string" ? body.model.trim() : "";
    if (!model || !isValidPrimaryModel(model)) {
      return Response.json(
        { error: "Field 'model' must be a provider-prefixed model id such as 'openrouter/deepseek/deepseek-v4-pro'." },
        { status: 400 },
      );
    }
    try {
      const result = setPrimaryModel(model);
      const refresh = result.changed
        ? await refreshIntegrationsRuntime()
        : { attempted: false, restarted: false, error: null, profile: "default" as const };
      return Response.json({ ok: true, changed: result.changed, model: result.model, refresh });
    } catch (err) {
      return Response.json(
        { error: err instanceof Error ? err.message : "Failed to set primary model." },
        { status: 500 },
      );
    }
  }

  if (body.action === "set_thinking") {
    if (!isChatThinkingLevel(body.thinkingLevel)) {
      return Response.json(
        { error: "Field 'thinkingLevel' must be one of 'off', 'minimal', 'low', 'medium', 'high', 'xhigh'." },
        { status: 400 },
      );
    }
    try {
      const result = await setChatThinkingLevel(body.thinkingLevel);
      return Response.json({ ok: true, ...result });
    } catch (err) {
      return Response.json(
        { error: err instanceof Error ? err.message : "Failed to set thinking level." },
        { status: 500 },
      );
    }
  }

  return Response.json(
    { error: "Unknown action. Use 'save_key', 'select_model', 'save_voice', 'save_active_settings', 'set_thinking', or 'set_primary_model'." },
    { status: 400 },
  );
}
