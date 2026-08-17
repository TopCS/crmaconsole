// extensions/crm-a-shopify-admin/index.ts
var id = "crm-a-shopify-admin";
var TOOL_NAME = "shopify_admin";
var DEFAULT_WEB_PORT = 3100;
var TIMEOUT_MS = 6e4;
function readString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : void 0;
}
function readNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : void 0;
  }
  return void 0;
}
function resolveWebBaseUrl() {
  return (readString(process.env.CRM_A_CONSOLE_WEB_BASE_URL) ?? `http://127.0.0.1:${DEFAULT_WEB_PORT}`).replace(/\/$/, "");
}
function secret() {
  return readString(process.env.CRM_A_PHONE_WEBHOOK_SECRET);
}
var PARAMETERS = {
  type: "object",
  additionalProperties: false,
  properties: {
    action: {
      type: "string",
      enum: ["store-info", "list-products", "ensure-product", "list-orders", "fulfill-order"],
      description: "Shopify operation. Read operations are safe; ensure-product and fulfill-order mutate the store."
    },
    limit: { type: "number", description: "Maximum products or orders to return." },
    query: { type: "string", description: "Shopify product search query." },
    status: { type: "string", description: "Order status filter (any, open, closed, cancelled, paid, unpaid, refunded)." },
    title: { type: "string", description: "New product title." },
    sku: { type: "string", description: "Product SKU used to find an existing product before creation." },
    price: { type: "number", description: "Optional initial product price." },
    orderId: { type: "string", description: "Shopify numeric order id or gid." },
    trackingNumber: { type: "string", description: "Carrier tracking number for fulfillment." },
    carrier: { type: "string", description: "Carrier name; defaults to GLS." },
    confirm: { type: "boolean", description: "Required true for product creation or fulfillment." }
  },
  required: ["action"]
};
function result(payload) {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    details: payload
  };
}
async function callRoute(baseUrl, authSecret, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl}/api/shopify/admin`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${authSecret}`
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const text = await response.text();
    let bodyValue = {};
    try {
      bodyValue = text ? JSON.parse(text) : {};
    } catch {
      bodyValue = { error: text.slice(0, 500) };
    }
    return { status: response.status, body: bodyValue };
  } finally {
    clearTimeout(timer);
  }
}
function createTool(baseUrl, authSecret) {
  return {
    name: TOOL_NAME,
    label: "Shopify Admin",
    description: "Query the connected Shopify store from chat. Read store info, products, and orders; create a product or fulfill an order only after the operator explicitly confirms.",
    parameters: PARAMETERS,
    async execute(_toolCallId, input) {
      const action = readString(input.action);
      if (!action) {
        return result({ error: "action is required." });
      }
      if ((action === "ensure-product" || action === "fulfill-order") && input.confirm !== true) {
        return result({ error: `${action} requires confirm: true. Ask the operator first.`, needsConfirmation: true });
      }
      const body = { action };
      for (const key of ["query", "status", "title", "sku", "orderId", "trackingNumber", "carrier"]) {
        const value = readString(input[key]);
        if (value) {
          body[key] = value;
        }
      }
      for (const key of ["limit", "price"]) {
        const value = readNumber(input[key]);
        if (value !== void 0) {
          body[key] = value;
        }
      }
      if (input.confirm === true) {
        body.confirm = true;
      }
      try {
        const response = await callRoute(baseUrl, authSecret, body);
        if (response.status >= 400) {
          return result({ error: response.body.error ?? `Shopify request failed (HTTP ${response.status}).`, ...response.body });
        }
        return result(response.body);
      } catch (error) {
        return result({ error: `Shopify request failed: ${error instanceof Error ? error.message : String(error)}` });
      }
    }
  };
}
function register(api) {
  const configured = api.config?.plugins?.entries?.[id]?.config;
  if (configured?.enabled === false) {
    return;
  }
  const authSecret = secret();
  if (!authSecret) {
    api.logger?.info?.(`[${id}] CRM_A_PHONE_WEBHOOK_SECRET not set; tool not registered.`);
    return;
  }
  const baseUrl = resolveWebBaseUrl();
  api.registerTool(createTool(baseUrl, authSecret), { name: TOOL_NAME, optional: true });
  api.logger?.info?.(`[${id}] registered ${TOOL_NAME} (web: ${baseUrl})`);
}
export {
  register as default,
  id
};
