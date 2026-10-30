// extensions/crm-a-maxxi/index.ts
var id = "crm-a-maxxi";
var DEFAULT_WEB_PORT = 3100;
var CALL_TIMEOUT_MS = 3e4;
function readString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : void 0;
}
function serviceToken() {
  return process.env.CRM_A_SERVICE_TOKEN?.trim() || process.env.CRM_A_PHONE_WEBHOOK_SECRET?.trim() || void 0;
}
function resolveWebBaseUrl() {
  const fromEnv = process.env.CRM_A_CONSOLE_WEB_BASE_URL?.trim();
  if (fromEnv) {
    return fromEnv.replace(/\/$/, "");
  }
  return `http://127.0.0.1:${DEFAULT_WEB_PORT}`;
}
function jsonResult(payload) {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    details: payload
  };
}
async function callApi(baseUrl, token, path, init) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      method: init?.method ?? "GET",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`,
        ...init?.body === void 0 ? {} : { "content-type": "application/json" }
      },
      body: init?.body === void 0 ? void 0 : JSON.stringify(init.body),
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
function createPerson360Tool(baseUrl, token) {
  return {
    name: "maxxi_person_360",
    label: "MAXXI \xB7 profilo 360",
    description: "Read a synthetic MAXXI visitor's 360 profile: identity source links, timeline events with provenance, memberships, consents, infopoint feedback and related organizations. Read-only. Use it to answer 'chi \xE8 questa persona' and 'da quali sistemi viene'. Data is demo-synthetic.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        personId: { type: "string", description: "Person id (e.g. P-MARIA)." },
        name: { type: "string", description: "Full name, resolved against the demo people list." }
      }
    },
    async execute(_toolCallId, input) {
      let personId = readString(input.personId);
      const name = readString(input.name);
      if (!personId && name) {
        const list = await callApi(baseUrl, token, "/api/maxxi/people");
        const people = list.body.people ?? [];
        personId = people.find((person) => person.name.toLowerCase() === name.toLowerCase())?.id;
      }
      if (!personId) {
        return jsonResult({ error: "personId or a resolvable name is required." });
      }
      const { status, body } = await callApi(baseUrl, token, `/api/maxxi/people?id=${encodeURIComponent(personId)}`);
      if (status >= 400) {
        return jsonResult({ error: body.error ?? `HTTP ${status}` });
      }
      return jsonResult(body);
    }
  };
}
function createSegmentTool(baseUrl, token) {
  return {
    name: "maxxi_segment_arch_renewal",
    label: "MAXXI \xB7 segmento architettura + rinnovo",
    description: "Evaluate the deterministic segment of myMAXXI holders interested in architecture whose card expires within 45 days, with at least one interaction in the last 365 days and a valid event_marketing/email consent. Returns eligible people, exclusion reasons and the fixed demo window. Read-only.",
    parameters: { type: "object", additionalProperties: false, properties: {} },
    async execute() {
      const { status, body } = await callApi(baseUrl, token, "/api/maxxi/segment");
      if (status >= 400) {
        return jsonResult({ error: body.error ?? `HTTP ${status}` });
      }
      return jsonResult(body);
    }
  };
}
function createCampaignProposalTool(baseUrl, token) {
  return {
    name: "maxxi_campaign_proposal",
    label: "MAXXI \xB7 proposta campagna (dry run)",
    description: "Create a DRY-RUN campaign draft for the eligible architecture/renewal audience. Nothing is ever sent: the demo blocks all outbound providers server-side. Use only after the operator asked for a proposal; the draft is audited and shown in the Campaigns view.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        subject: { type: "string", description: "Draft subject." },
        body: { type: "string", description: "Draft body text. Cite only public exhibition facts." },
        confirm: { type: "boolean", description: "MUST be true to create the draft." }
      },
      required: ["subject", "body"]
    },
    async execute(_toolCallId, input) {
      if (input.confirm !== true) {
        return jsonResult({
          error: "Refusing to create a campaign draft without confirmation.",
          needsConfirmation: true
        });
      }
      const subject = readString(input.subject);
      const body = readString(input.body);
      if (!subject || !body) {
        return jsonResult({ error: "subject and body are required." });
      }
      const res = await callApi(baseUrl, token, "/api/maxxi/campaigns", {
        method: "POST",
        body: { subject, body }
      });
      if (res.status >= 400) {
        return jsonResult({ error: res.body.error ?? `HTTP ${res.status}` });
      }
      return jsonResult({ ...res.body, outboundCalls: 0, deliveryMode: "dry_run" });
    }
  };
}
function register(api) {
  const token = serviceToken();
  if (!token) {
    api.logger?.info?.("[crm-a-maxxi] no service token configured; tools not registered.");
    return;
  }
  const baseUrl = resolveWebBaseUrl();
  api.registerTool(createPerson360Tool(baseUrl, token), { name: "maxxi_person_360", optional: true });
  api.registerTool(createSegmentTool(baseUrl, token), { name: "maxxi_segment_arch_renewal", optional: true });
  api.registerTool(createCampaignProposalTool(baseUrl, token), { name: "maxxi_campaign_proposal", optional: true });
  api.logger?.info?.(`[crm-a-maxxi] registered 3 read/dry-run tools (web: ${baseUrl})`);
}
export {
  register as default,
  id
};
