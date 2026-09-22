// extensions/crm-a-nlpearl-outbound/index.ts
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
var id = "crm-a-nlpearl-outbound";
var TOOL_NAME = "crm_a_phone_campaign";
var INBOUND_TOOL_NAME = "crm_a_inbound_care";
var DEFAULT_WEB_PORT = 3100;
var PROCESS_JSON_REL = path.join("web-runtime", "process.json");
var CALL_TIMEOUT_MS = 6e4;
function readString(v) {
  return typeof v === "string" && v.trim() ? v.trim() : void 0;
}
function readNumber(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : void 0;
}
function asRecord(v) {
  return v && typeof v === "object" && !Array.isArray(v) ? v : void 0;
}
function resolveStateDir() {
  const fromEnv = process.env.OPENCLAW_STATE_DIR?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  return path.join(process.env.OPENCLAW_HOME?.trim() || homedir(), ".openclaw-crm-a");
}
function resolvePortFromProcessFile(stateDir) {
  try {
    const p = path.join(stateDir, PROCESS_JSON_REL);
    if (!existsSync(p)) {
      return void 0;
    }
    const parsed = JSON.parse(readFileSync(p, "utf-8"));
    return readNumber(parsed?.port);
  } catch {
    return void 0;
  }
}
function resolveWebBaseUrl() {
  const fromEnv = readString(process.env.CRM_A_CONSOLE_WEB_BASE_URL);
  if (fromEnv) {
    return fromEnv.replace(/\/$/, "");
  }
  const port = resolvePortFromProcessFile(resolveStateDir()) ?? DEFAULT_WEB_PORT;
  return `http://127.0.0.1:${port}`;
}
function phoneWebhookSecret() {
  return process.env.CRM_A_PHONE_WEBHOOK_SECRET?.trim() || void 0;
}
var ACTIONS = ["upsert", "create", "send", "pause", "resume"];
var PHONE_CAMPAIGN_PARAMETERS = {
  type: "object",
  additionalProperties: false,
  properties: {
    action: {
      type: "string",
      enum: [...ACTIONS],
      description: "upsert: create/update the campaign card. create: build the NLPearl Pearl (paused). send: enqueue leads (requires confirm:true). pause/resume: toggle Pearl activity (resume requires confirm:true)."
    },
    campaignId: {
      type: "string",
      description: "Campaign entry id; omit on upsert to create a new card, or provide to update."
    },
    name: { type: "string", description: "Campaign name." },
    phoneId: { type: "string", description: "NLPearl outbound-authorized Phone ID." },
    phoneNumber: {
      type: "string",
      description: "Outbound number the campaign dials from (e.g. +3939065457620). The console resolves it to the NLPearl Phone ID automatically \u2014 prefer this when the operator gives a number instead of an id."
    },
    windowStart: { type: "string", description: "Calling window start (HH:MM)." },
    windowEnd: { type: "string", description: "Calling window end (HH:MM)." },
    timezone: { type: "string", description: "IANA timezone (e.g. Europe/Rome)." },
    days: { type: "array", items: { type: "number" }, description: "Calling days (1=Mon..7=Sun)." },
    maxAttempts: { type: "number", description: "Max call attempts (route caps at 5)." },
    retryRate: { type: "number", description: "Minimum retry interval hours." },
    agentCount: { type: "number", description: "Concurrent agents." },
    brief: { type: "string", description: "Voice Brief: the offer the Pearl should communicate (product + comparisons)." },
    segmentName: {
      type: "string",
      description: 'Audience segment name (e.g. "Lancio Samsung Galaxy"). Resolved to the segment entry and linked on the campaign card; send() scopes the audience to it.'
    },
    brandName: { type: "string", description: "Brand name the Pearl introduces itself with." },
    greetingScript: { type: "string", description: "Opening line the Pearl says." },
    knowledgeBase: { type: "string", description: "Knowledge Base / dossier text the Pearl may quote on the call." },
    pearlId: {
      type: "string",
      description: "Existing NLPearl Outbound Pearl id (upsert) \u2014 reuse it instead of creating a new one. When set, create/send target it without building."
    },
    pearlName: {
      type: "string",
      description: "Existing NLPearl Outbound Pearl NAME (upsert) \u2014 resolved to its id, so the demo can reuse a pre-provisioned Pearl by name. Validated as outbound."
    },
    criteria: {
      type: "object",
      additionalProperties: false,
      properties: {
        segmentId: { type: "string", description: "Restrict to a CDP segment (phone-compliant members)." },
        count: {
          type: "number",
          description: "Cap the number of leads (default 500; segment-scoped audiences are capped at 200 by the CDP member resolver)."
        }
      },
      description: "Audience criteria for send: segment + count over the mandatory opt-in/phone-compliance filter."
    },
    confirm: { type: "boolean", description: "MUST be true to run send or resume; anything else refuses the action." }
  },
  required: ["action"]
};
function jsonResult(payload) {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    details: payload
  };
}
async function callPhoneRoute(webBaseUrl, secret, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);
  try {
    const res = await fetch(`${webBaseUrl}/api/campaigns/phone`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        authorization: `Bearer ${secret}`
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const text = await res.text();
    let parsed = {};
    if (text.trim()) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = { error: text.slice(0, 240) };
      }
    }
    return { status: res.status, body: parsed };
  } finally {
    clearTimeout(timer);
  }
}
var INBOUND_ACTIONS = ["create", "activate", "pause"];
var INBOUND_CARE_PARAMETERS = {
  type: "object",
  additionalProperties: false,
  properties: {
    action: {
      type: "string",
      enum: [...INBOUND_ACTIONS],
      description: "create: build the inbound customer-care Pearl (paused). activate/pause: toggle the inbound Pearl's activity (activate requires confirm:true)."
    },
    name: { type: "string", description: "Inbound Pearl name (create)." },
    phoneId: { type: "string", description: "NLPearl phone number ID assigned to the inbound number (create)." },
    phoneNumber: {
      type: "string",
      description: "Inbound number as dialed by customers (e.g. +3939065457620). The console resolves it to the NLPearl Phone ID automatically \u2014 prefer this when the operator gives a number."
    },
    brief: { type: "string", description: "Marketing Message MD the agent should speak (create)." },
    pearlId: { type: "string", description: "Inbound Pearl ID (activate/pause)." },
    pearlName: {
      type: "string",
      description: "Existing inbound Pearl NAME (activate/pause) \u2014 resolved to its id, so the demo can reuse a pre-provisioned Pearl without creating one."
    },
    confirm: { type: "boolean", description: "MUST be true to run activate; anything else refuses the action." }
  },
  required: ["action"]
};
async function callInboundRoute(webBaseUrl, secret, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);
  try {
    const res = await fetch(`${webBaseUrl}/api/nlpearl/inbound`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        authorization: `Bearer ${secret}`
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const text = await res.text();
    let parsed = {};
    if (text.trim()) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = { error: text.slice(0, 240) };
      }
    }
    return { status: res.status, body: parsed };
  } finally {
    clearTimeout(timer);
  }
}
async function callMultichannelRoute(webBaseUrl, secret, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);
  try {
    const res = await fetch(`${webBaseUrl}/api/campaigns/send-multichannel`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        authorization: `Bearer ${secret}`
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const text = await res.text();
    let parsed = {};
    if (text.trim()) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = { error: text.slice(0, 240) };
      }
    }
    return { status: res.status, body: parsed };
  } finally {
    clearTimeout(timer);
  }
}
async function callPhoneWebhook(webBaseUrl, secret, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);
  try {
    const res = await fetch(`${webBaseUrl}/api/webhooks/phone`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        authorization: `Bearer ${secret}`
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const text = await res.text();
    let parsed = {};
    if (text.trim()) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = { error: text.slice(0, 240) };
      }
    }
    return { status: res.status, body: parsed };
  } finally {
    clearTimeout(timer);
  }
}
async function callTelegramPersonRoute(webBaseUrl, secret, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);
  try {
    const res = await fetch(`${webBaseUrl}/api/campaigns/telegram-person`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        authorization: `Bearer ${secret}`
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const text = await res.text();
    let parsed = {};
    if (text.trim()) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = { error: text.slice(0, 240) };
      }
    }
    return { status: res.status, body: parsed };
  } finally {
    clearTimeout(timer);
  }
}
function createInboundCareTool(webBaseUrl, secret) {
  return {
    name: INBOUND_TOOL_NAME,
    label: "NLPearl inbound customer care",
    description: "Drive the NLPearl inbound customer-care Pearl from chat. create: build the inbound Pearl (paused, PreCallAPI greeting + order memory + offer brief). activate/pause: toggle whether the inbound number is answered; pass pearlId or pearlName to reuse an already-provisioned Pearl. activate requires the operator's explicit confirmation (confirm: true).",
    parameters: INBOUND_CARE_PARAMETERS,
    async execute(_toolCallId, input) {
      const action = readString(input.action);
      if (!action) {
        return jsonResult({ error: "action is required: create|activate|pause" });
      }
      const confirm = input.confirm === true;
      if (action === "activate" && !confirm) {
        return jsonResult({
          error: "Refusing to activate without confirmation. Ask the operator to confirm, then call again with confirm: true.",
          needsConfirmation: true
        });
      }
      const body = { action };
      if (action === "create") {
        for (const k of ["name", "phoneId", "phoneNumber", "brief"]) {
          const v = readString(input[k]);
          if (v) {
            body[k] = v;
          }
        }
      } else {
        const pearlId = readString(input.pearlId);
        const pearlName = readString(input.pearlName);
        if (!pearlId && !pearlName) {
          return jsonResult({ error: "pearlId or pearlName is required for activate/pause." });
        }
        if (pearlId) {
          body.pearlId = pearlId;
        }
        if (pearlName) {
          body.pearlName = pearlName;
        }
      }
      try {
        const { status, body: resBody } = await callInboundRoute(webBaseUrl, secret, body);
        if (status >= 400) {
          return jsonResult({ error: resBody.error ?? `Inbound care ${action} failed (HTTP ${status}).` });
        }
        return jsonResult(resBody);
      } catch (err) {
        return jsonResult({ error: `Inbound care ${action} request failed: ${err instanceof Error ? err.message : String(err)}` });
      }
    }
  };
}
function createPhoneCampaignTool(webBaseUrl, secret) {
  return {
    name: TOOL_NAME,
    label: "NLPearl outbound phone campaign",
    description: "Drive an NLPearl outbound voice campaign from chat. upsert: create/update the campaign card (name, phone config, Voice Brief); pass pearlId/pearlName to REUSE an already-provisioned outbound Pearl instead of creating one. create: build the NLPearl Pearl on NLPearl (paused, nothing dialed yet). send: enqueue the phone-compliant audience as NLPearl leads. pause/resume: pause or activate the Pearl. send and resume (which start dialing) require the operator's explicit confirmation (confirm: true).",
    parameters: PHONE_CAMPAIGN_PARAMETERS,
    async execute(_toolCallId, input) {
      const action = readString(input.action);
      if (!action) {
        return jsonResult({ error: "action is required: upsert|create|send|pause|resume" });
      }
      const confirm = input.confirm === true;
      if ((action === "send" || action === "resume") && !confirm) {
        return jsonResult({
          error: `Refusing to ${action} without confirmation. Ask the operator to confirm, then call again with confirm: true.`,
          needsConfirmation: true
        });
      }
      const body = { action };
      if (action !== "upsert") {
        const campaignId = readString(input.campaignId);
        if (!campaignId) {
          return jsonResult({ error: "campaignId is required for this action." });
        }
        body.campaignId = campaignId;
      } else {
        if (readString(input.campaignId)) {
          body.campaignId = readString(input.campaignId);
        }
        for (const k of [
          "name",
          "phoneId",
          "phoneNumber",
          "windowStart",
          "windowEnd",
          "timezone",
          "brief",
          "segmentName",
          "brandName",
          "greetingScript",
          "knowledgeBase",
          "pearlId",
          "pearlName"
        ]) {
          const v = readString(input[k]);
          if (v) {
            body[k] = v;
          }
        }
        if (Array.isArray(input.days)) {
          body.days = input.days.filter((d) => typeof d === "number");
        }
        for (const k of ["maxAttempts", "retryRate", "agentCount"]) {
          const n = typeof input[k] === "number" ? input[k] : Number(input[k]);
          if (Number.isFinite(n)) {
            body[k] = n;
          }
        }
      }
      if (action === "create") {
        for (const k of ["brief", "brandName", "greetingScript", "knowledgeBase"]) {
          const v = readString(input[k]);
          if (v) {
            body[k] = v;
          }
        }
      }
      if (action === "send" && asRecord(input.criteria)) {
        const c = asRecord(input.criteria);
        const criteria = {};
        if (readString(c.segmentId)) {
          criteria.segmentId = readString(c.segmentId);
        }
        if (typeof c.count === "number") {
          criteria.count = c.count;
        }
        if (Object.keys(criteria).length > 0) {
          body.criteria = criteria;
        }
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
    }
  };
}
var MULTICHANNEL_PARAMETERS = {
  type: "object",
  additionalProperties: false,
  properties: {
    segmentEntryId: {
      type: "string",
      description: "Segment entry id to target. Omit when segmentName is given."
    },
    segmentName: {
      type: "string",
      description: 'Segment name (e.g. "Lancio Samsung Galaxy") \u2014 resolved to its entry id automatically.'
    },
    subject: { type: "string", description: "Subject/heading of the message (email subject, telegram first line)." },
    body: { type: "string", description: "Message body to send." },
    preview: {
      type: "boolean",
      description: "When true, does NOT deliver: returns the per-channel routing matrix (who lands on Telegram vs email). Use this for the demo / dry-run before sending for real."
    },
    confirm: {
      type: "boolean",
      description: "MUST be true to run a real send (preview:false). Anything else refuses the action. Ask the operator for explicit confirmation first."
    }
  },
  required: ["body"]
};
function createMultichannelTool(webBaseUrl, secret) {
  return {
    name: "crm_a_multichannel",
    label: "Crm-A multichannel send (Atto 3/4)",
    description: "Send a launch message to a segment's audience, routing each recipient by their Preferred Contact Channel (Telegram via the OpenClaw runtime, email via SES). With preview: true it returns the routing matrix without delivering anything \u2014 perfect for demoing who lands where. A real send requires the operator's explicit confirmation (confirm: true).",
    parameters: MULTICHANNEL_PARAMETERS,
    async execute(_toolCallId, input) {
      const segmentEntryId = readString(input.segmentEntryId);
      const segmentName = readString(input.segmentName);
      if (!segmentEntryId && !segmentName) {
        return jsonResult({ error: "segmentEntryId or segmentName is required." });
      }
      const subject = readString(input.subject) ?? "";
      const body = readString(input.body);
      if (!body) {
        return jsonResult({ error: "body is required." });
      }
      const preview = input.preview === true;
      const confirm = input.confirm === true;
      if (!preview && !confirm) {
        return jsonResult({
          error: "Refusing to send for real without confirmation. Ask the operator to confirm, then call again with confirm: true (or use preview: true for a dry-run).",
          needsConfirmation: true
        });
      }
      const payload = {
        subject,
        body,
        preview
      };
      if (segmentEntryId) {
        payload.segmentEntryId = segmentEntryId;
      } else {
        payload.segmentName = segmentName;
      }
      try {
        const { status, body: resBody } = await callMultichannelRoute(webBaseUrl, secret, payload);
        if (status >= 400) {
          return jsonResult({ error: resBody.error ?? `Multichannel send failed (HTTP ${status}).` });
        }
        return jsonResult(resBody);
      } catch (err) {
        return jsonResult({ error: `Multichannel send request failed: ${err instanceof Error ? err.message : String(err)}` });
      }
    }
  };
}
var TELEGRAM_PERSON_PARAMETERS = {
  type: "object",
  additionalProperties: false,
  properties: {
    personEntryId: {
      type: "string",
      description: "Person entry id to message. Omit when personName is given."
    },
    personName: {
      type: "string",
      description: `Person's Full Name (e.g. "Lorenzo Lorato") \u2014 resolved to their entry id automatically.`
    },
    subject: { type: "string", description: "Optional heading prepended to the message." },
    body: { type: "string", description: "Message text to send." },
    preview: {
      type: "boolean",
      description: "When true, does NOT deliver: returns who the person resolved to and the delivery target (telegram:<id> or phone:<e164>)."
    },
    confirm: {
      type: "boolean",
      description: "MUST be true to run a real send (preview:false). Anything else refuses the action. Ask the operator for explicit confirmation first."
    }
  },
  required: ["body"]
};
function createTelegramPersonTool(webBaseUrl, secret) {
  return {
    name: "crm_a_telegram_person",
    label: "Send a Telegram message to a person",
    description: `Send a Telegram message to a single person by name (e.g. "manda un messaggio Telegram a Lorenzo Lorato"). Resolves the person, delivers on their session (telegram:<id> if their Telegram User ID is on file, else phone:<e164>). With preview: true it returns the resolved target without delivering. A real send requires the operator's explicit confirmation (confirm: true).`,
    parameters: TELEGRAM_PERSON_PARAMETERS,
    async execute(_toolCallId, input) {
      const personEntryId = readString(input.personEntryId);
      const personName = readString(input.personName);
      if (!personEntryId && !personName) {
        return jsonResult({ error: "personEntryId or personName is required." });
      }
      const subject = readString(input.subject) ?? "";
      const body = readString(input.body);
      if (!body) {
        return jsonResult({ error: "body is required." });
      }
      const preview = input.preview === true;
      const confirm = input.confirm === true;
      if (!preview && !confirm) {
        return jsonResult({
          error: "Refusing to send for real without confirmation. Ask the operator to confirm, then call again with confirm: true (or use preview: true for a dry-run).",
          needsConfirmation: true
        });
      }
      const payload = {
        subject,
        body,
        preview
      };
      if (personEntryId) {
        payload.personEntryId = personEntryId;
      } else {
        payload.personName = personName;
      }
      try {
        const { status, body: resBody } = await callTelegramPersonRoute(webBaseUrl, secret, payload);
        if (status >= 400) {
          return jsonResult({ error: resBody.error ?? `Telegram send failed (HTTP ${status}).` });
        }
        return jsonResult(resBody);
      } catch (err) {
        return jsonResult({ error: `Telegram send request failed: ${err instanceof Error ? err.message : String(err)}` });
      }
    }
  };
}
function registerInboundBridge(api, webBaseUrl, secret) {
  api.on(
    "message_received",
    async (event, ctx) => {
      try {
        const channel = String(ctx?.channelId ?? "").toLowerCase();
        if (channel !== "telegram") {
          return;
        }
        const content = typeof event?.content === "string" ? event.content.trim() : "";
        if (!content) {
          return;
        }
        const meta = event?.metadata ?? {};
        const telegramUserId = readString(meta.senderId);
        const name = readString(meta.senderName);
        const phone = readString(meta.senderE164);
        const messageId = readString(meta.messageId);
        const payload = {
          action: "message",
          text: content,
          contact: { telegramUserId: telegramUserId ?? "", name: name ?? null, phone: phone ?? null }
        };
        if (messageId) {
          payload.messageId = messageId;
        }
        const { status, body } = await callPhoneWebhook(webBaseUrl, secret, payload);
        if (status >= 400) {
          api.logger?.info?.(
            `[crm-a-nlpearl-outbound] inbound telegram forwarded failed (${status}): ${String(body.error ?? "")}`
          );
          return;
        }
        const context = readString(body.context);
        if (!context) {
          return;
        }
        const to = readString(event?.from) ?? telegramUserId;
        if (!to) {
          return;
        }
        api.runtime?.channel?.telegram?.sendMessageTelegram?.(to, context).catch((err) => {
          api.logger?.info?.(
            `[crm-a-nlpearl-outbound] inbound telegram reply failed: ${err instanceof Error ? err.message : String(err)}`
          );
        });
      } catch (err) {
        api.logger?.info?.(
          `[crm-a-nlpearl-outbound] inbound telegram bridge error: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    },
    { priority: 100 }
  );
}
function register(api) {
  const rootConfig = asRecord(api?.config);
  const pluginEntries = asRecord(asRecord(rootConfig?.plugins)?.entries);
  const pluginConfig = asRecord(asRecord(pluginEntries?.[id])?.config);
  if (pluginConfig?.enabled === false) {
    return;
  }
  const secret = phoneWebhookSecret();
  if (!secret) {
    api.logger?.info?.(
      `[crm-a-nlpearl-outbound] CRM_A_PHONE_WEBHOOK_SECRET not set; tool not registered.`
    );
    return;
  }
  const webBaseUrl = resolveWebBaseUrl();
  api.registerTool(createPhoneCampaignTool(webBaseUrl, secret), {
    name: TOOL_NAME,
    optional: true
  });
  api.registerTool(createInboundCareTool(webBaseUrl, secret), {
    name: INBOUND_TOOL_NAME,
    optional: true
  });
  api.registerTool(createMultichannelTool(webBaseUrl, secret), {
    name: "crm_a_multichannel",
    optional: true
  });
  api.registerTool(createTelegramPersonTool(webBaseUrl, secret), {
    name: "crm_a_telegram_person",
    optional: true
  });
  registerInboundBridge(api, webBaseUrl, secret);
  api.logger?.info?.(`[crm-a-nlpearl-outbound] registered ${TOOL_NAME} + ${INBOUND_TOOL_NAME} + crm_a_multichannel + crm_a_telegram_person + inbound bridge (web: ${webBaseUrl})`);
}
export {
  register as default,
  id
};
