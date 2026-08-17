/**
 * Crm-A Console — Shopify Admin API chat tool.
 *
 * The tool calls the local web route so credentials stay server-side. Read
 * actions are available from chat; product creation and fulfillment require
 * explicit confirm:true because they mutate the store.
 */

import type { AnyAgentTool } from "openclaw/plugin-sdk";

export const id = "crm-a-shopify-admin";
const TOOL_NAME = "shopify_admin";
const DEFAULT_WEB_PORT = 3100;
const TIMEOUT_MS = 60_000;
type UnknownRecord = Record<string, unknown>;

type PluginConfig = {
  plugins?: {
    entries?: Record<string, { config?: { enabled?: boolean } }>;
  };
};

type PluginApi = {
  config?: PluginConfig;
  logger?: { info?: (message: string) => void };
  registerTool: (tool: AnyAgentTool, options?: { name?: string; optional?: boolean }) => void;
};

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {return value;}
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function resolveWebBaseUrl(): string {
  return (readString(process.env.CRM_A_CONSOLE_WEB_BASE_URL) ?? `http://127.0.0.1:${DEFAULT_WEB_PORT}`).replace(/\/$/, "");
}

function secret(): string | undefined {
  return readString(process.env.CRM_A_PHONE_WEBHOOK_SECRET);
}

const PARAMETERS = {
  type: "object",
  additionalProperties: false,
  properties: {
    action: {
      type: "string",
      enum: ["store-info", "list-products", "ensure-product", "list-orders", "fulfill-order"],
      description: "Shopify operation. Read operations are safe; ensure-product and fulfill-order mutate the store.",
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
    confirm: { type: "boolean", description: "Required true for product creation or fulfillment." },
  },
  required: ["action"],
} as const;

function result(payload: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
    details: payload as Record<string, unknown>,
  };
}

async function callRoute(baseUrl: string, authSecret: string, body: UnknownRecord): Promise<{ status: number; body: UnknownRecord }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl}/api/shopify/admin`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${authSecret}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    let bodyValue: UnknownRecord = {};
    try {bodyValue = text ? JSON.parse(text) as UnknownRecord : {};} catch {bodyValue = { error: text.slice(0, 500) };}
    return { status: response.status, body: bodyValue };
  } finally {
    clearTimeout(timer);
  }
}

function createTool(baseUrl: string, authSecret: string): AnyAgentTool {
  return {
    name: TOOL_NAME,
    label: "Shopify Admin",
    description: "Query the connected Shopify store from chat. Read store info, products, and orders; create a product or fulfill an order only after the operator explicitly confirms.",
    parameters: PARAMETERS,
    async execute(_toolCallId: string, input: UnknownRecord) {
      const action = readString(input.action);
      if (!action) {return result({ error: "action is required." });}
      if ((action === "ensure-product" || action === "fulfill-order") && input.confirm !== true) {
        return result({ error: `${action} requires confirm: true. Ask the operator first.`, needsConfirmation: true });
      }
      const body: UnknownRecord = { action };
      for (const key of ["query", "status", "title", "sku", "orderId", "trackingNumber", "carrier"] as const) {
        const value = readString(input[key]);
        if (value) {body[key] = value;}
      }
      for (const key of ["limit", "price"] as const) {
        const value = readNumber(input[key]);
        if (value !== undefined) {body[key] = value;}
      }
      if (input.confirm === true) {body.confirm = true;}
      try {
        const response = await callRoute(baseUrl, authSecret, body);
        if (response.status >= 400) {return result({ error: response.body.error ?? `Shopify request failed (HTTP ${response.status}).`, ...response.body });}
        return result(response.body);
      } catch (error) {
        return result({ error: `Shopify request failed: ${error instanceof Error ? error.message : String(error)}` });
      }
    },
  } as AnyAgentTool;
}

export default function register(api: PluginApi) {
  const configured = api.config?.plugins?.entries?.[id]?.config;
  if (configured?.enabled === false) {return;}
  const authSecret = secret();
  if (!authSecret) {
    api.logger?.info?.(`[${id}] CRM_A_PHONE_WEBHOOK_SECRET not set; tool not registered.`);
    return;
  }
  const baseUrl = resolveWebBaseUrl();
  api.registerTool(createTool(baseUrl, authSecret), { name: TOOL_NAME, optional: true });
  api.logger?.info?.(`[${id}] registered ${TOOL_NAME} (web: ${baseUrl})`);
}
