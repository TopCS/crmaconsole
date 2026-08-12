/**
 * Crm-A Console — NLPearl outbound phone campaign agent tool.
 *
 * Registers `crm_a_phone_campaign`, which lets the chat agent drive
 * outbound phone campaigns end-to-end by calling the existing
 * `POST /api/campaigns/phone` route on the local web app:
 *
 *   upsert  → create/update the campaign card (name, phone config, Voice Brief)
 *   create  → build the NLPearl Voice Pearl (paused; no dialing)
 *   send    → enqueue the phone-compliant audience as NLPearl leads
 *   pause / resume → toggle Pearl activity
 *
 * Safety: `send` and `resume` (which starts dialing) REQUIRE the caller to
 * pass `confirm: true`, else the tool refuses. The agent must ask the
 * operator for explicit confirmation before sending leads or activating.
 *
 * Auth: reuses `CRM_A_PHONE_WEBHOOK_SECRET` (the same secret the route
 * validates) read from the shared env. If not set the tool is not
 * registered — mirroring how other extensions gate on a missing key.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { AnyAgentTool } from "openclaw/plugin-sdk";

export const id = "crm-a-nlpearl-outbound";

const TOOL_NAME = "crm_a_phone_campaign";
const DEFAULT_WEB_PORT = 3100;
const PROCESS_JSON_REL = path.join("web-runtime", "process.json");
const CALL_TIMEOUT_MS = 60_000;

type UnknownRecord = Record<string, unknown>;

function readString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}
function readNumber(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}
function asRecord(v: unknown): UnknownRecord | undefined {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as UnknownRecord) : undefined;
}

function resolveStateDir(): string {
  const fromEnv = process.env.OPENCLAW_STATE_DIR?.trim();
  if (fromEnv) { return fromEnv; }
  return path.join(process.env.OPENCLAW_HOME?.trim() || homedir(), ".openclaw-crm-a");
}

function resolvePortFromProcessFile(stateDir: string): number | undefined {
  try {
    const p = path.join(stateDir, PROCESS_JSON_REL);
    if (!existsSync(p)) { return undefined; }
    const parsed = JSON.parse(readFileSync(p, "utf-8")) as UnknownRecord;
    return readNumber(parsed?.port);
  } catch {
    return undefined;
  }
}

function resolveWebBaseUrl(): string {
  const fromEnv = readString(process.env.CRM_A_CONSOLE_WEB_BASE_URL);
  if (fromEnv) { return fromEnv.replace(/\/$/, ""); }
  const port = resolvePortFromProcessFile(resolveStateDir()) ?? DEFAULT_WEB_PORT;
  return `http://127.0.0.1:${port}`;
}

function phoneWebhookSecret(): string | undefined {
  return process.env.CRM_A_PHONE_WEBHOOK_SECRET?.trim() || undefined;
}

const ACTIONS = ["upsert", "create", "send", "pause", "resume"] as const;

const PHONE_CAMPAIGN_PARAMETERS = {
  type: "object",
  additionalProperties: false,
  properties: {
    action: {
      type: "string",
      enum: [...ACTIONS],
      description:
        "upsert: create/update the campaign card. create: build the NLPearl Pearl (paused). send: enqueue leads (requires confirm:true). pause/resume: toggle Pearl activity (resume requires confirm:true).",
    },
    campaignId: {
      type: "string",
      description: "Campaign entry id; omit on upsert to create a new card, or provide to update.",
    },
    name: { type: "string", description: "Campaign name." },
    phoneId: { type: "string", description: "NLPearl outbound-authorized Phone ID." },
    windowStart: { type: "string", description: "Calling window start (HH:MM)." },
    windowEnd: { type: "string", description: "Calling window end (HH:MM)." },
    timezone: { type: "string", description: "IANA timezone (e.g. Europe/Rome)." },
    days: { type: "array", items: { type: "number" }, description: "Calling days (1=Mon..7=Sun)." },
    maxAttempts: { type: "number", description: "Max call attempts (route caps at 5)." },
    retryRate: { type: "number", description: "Minimum retry interval hours." },
    agentCount: { type: "number", description: "Concurrent agents." },
    brief: { type: "string", description: "Voice Brief: the offer the Pearl should communicate (product + comparisons)." },
    criteria: {
      type: "object",
      additionalProperties: false,
      properties: {
        segmentId: { type: "string", description: "Restrict to a CDP segment (phone-compliant members)." },
        count: {
          type: "number",
          description: "Cap the number of leads (default 500; segment-scoped audiences are capped at 200 by the CDP member resolver).",
        },
      },
      description: "Audience criteria for send: segment + count over the mandatory opt-in/phone-compliance filter.",
    },
    confirm: { type: "boolean", description: "MUST be true to run send or resume; anything else refuses the action." },
  },
  required: ["action"],
} as const;

function jsonResult(payload: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
    details: payload as Record<string, unknown>,
  };
}

async function callPhoneRoute(
  webBaseUrl: string,
  secret: string,
  body: Record<string, unknown>,
): Promise<{ status: number; body: UnknownRecord }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);
  try {
    const res = await fetch(`${webBaseUrl}/api/campaigns/phone`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    let parsed: UnknownRecord = {};
    if (text.trim()) {
      try { parsed = JSON.parse(text) as UnknownRecord; } catch { parsed = { error: text.slice(0, 240) }; }
    }
    return { status: res.status, body: parsed };
  } finally {
    clearTimeout(timer);
  }
}

function createPhoneCampaignTool(webBaseUrl: string, secret: string): AnyAgentTool {
  return {
    name: TOOL_NAME,
    label: "NLPearl outbound phone campaign",
    description:
      "Drive an NLPearl outbound voice campaign from chat. upsert: create/update the campaign card (name, phone config, Voice Brief). create: build the NLPearl Pearl on NLPearl (paused, nothing dialed yet). send: enqueue the phone-compliant audience as NLPearl leads. pause/resume: pause or activate the Pearl. send and resume (which start dialing) require the operator's explicit confirmation (confirm: true).",
    parameters: PHONE_CAMPAIGN_PARAMETERS,
    async execute(_toolCallId: string, input: UnknownRecord) {
      const action = readString(input.action);
      if (!action) {
        return jsonResult({ error: "action is required: upsert|create|send|pause|resume" });
      }
      const confirm = input.confirm === true;
      if ((action === "send" || action === "resume") && !confirm) {
        return jsonResult({
          error: `Refusing to ${action} without confirmation. Ask the operator to confirm, then call again with confirm: true.`,
          needsConfirmation: true,
        });
      }

      const body: Record<string, unknown> = { action };
      if (action !== "upsert") {
        const campaignId = readString(input.campaignId);
        if (!campaignId) {
          return jsonResult({ error: "campaignId is required for this action." });
        }
        body.campaignId = campaignId;
      } else {
        if (readString(input.campaignId)) { body.campaignId = readString(input.campaignId); }
        for (const k of ["name", "phoneId", "windowStart", "windowEnd", "timezone", "brief"] as const) {
          const v = readString(input[k]);
          if (v) { body[k] = v; }
        }
        if (Array.isArray(input.days)) { body.days = input.days.filter((d) => typeof d === "number"); }
        for (const k of ["maxAttempts", "retryRate", "agentCount"] as const) {
          const n = typeof input[k] === "number" ? input[k] : Number(input[k]);
          if (Number.isFinite(n)) { body[k] = n; }
        }
      }
      if (action === "create" && readString(input.brief)) { body.brief = readString(input.brief); }
      if (action === "send" && asRecord(input.criteria)) {
        const c = asRecord(input.criteria) as UnknownRecord;
        const criteria: Record<string, unknown> = {};
        if (readString(c.segmentId)) { criteria.segmentId = readString(c.segmentId); }
        if (typeof c.count === "number") { criteria.count = c.count; }
        if (Object.keys(criteria).length > 0) { body.criteria = criteria; }
      }

      try {
        const { status, body: resBody } = await callPhoneRoute(webBaseUrl, secret, body);
        if (status >= 400) {
          return jsonResult({ error: resBody.error ?? `Campaign ${action} failed (HTTP ${status}).` });
        }
        return jsonResult(resBody);
      } catch (err) {
        return jsonResult({ error: `Campaign ${action} request failed: ${err instanceof Error ? err.message : String(err)}` });
      }
    },
  } as AnyAgentTool;
}

export default function register(api: any) {
  const rootConfig = asRecord(api?.config);
  const pluginEntries = asRecord(asRecord(rootConfig?.plugins)?.entries);
  const pluginConfig = asRecord(asRecord(pluginEntries?.[id])?.config);
  if (pluginConfig?.enabled === false) { return; }

  const secret = phoneWebhookSecret();
  if (!secret) {
    api.logger?.info?.(
      `[crm-a-nlpearl-outbound] CRM_A_PHONE_WEBHOOK_SECRET not set; tool not registered.`,
    );
    return;
  }
  const webBaseUrl = resolveWebBaseUrl();
  api.registerTool(createPhoneCampaignTool(webBaseUrl, secret), {
    name: TOOL_NAME,
    optional: true,
  });
  api.logger?.info?.(`[crm-a-nlpearl-outbound] registered ${TOOL_NAME} (web: ${webBaseUrl})`);
}
