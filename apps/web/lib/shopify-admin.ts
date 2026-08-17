import { readShopifyAdminToken, readShopifyApiVersion, readShopifyStoreDomain } from "./shopify-config";

const DEFAULT_API_VERSION = "2024-10";

type UnknownRecord = Record<string, unknown>;

export type ShopifyAdminProduct = {
  id: string;
  title: string;
  status: string;
  handle?: string;
  sku?: string;
  price?: string;
};

export type ShopifyAdminOrder = {
  id: string;
  order_number?: number;
  name?: string;
  email?: string;
  financial_status?: string;
  fulfillment_status?: string | null;
  total_price?: string;
  currency?: string;
  created_at?: string;
};

export type ShopifyAdminConfig = {
  storeDomain: string;
  adminToken: string;
  apiVersion: string;
};

export type EnsureProductInput = {
  title: string;
  sku?: string;
  price?: number;
};

export class ShopifyAdminError extends Error {
  readonly status: number;

  constructor(message: string, status = 502) {
    super(message);
    this.name = "ShopifyAdminError";
    this.status = status;
  }
}

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function storeHost(value: string): string {
  return value.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

function numericId(value: string): string {
  const tail = value.trim().split("/").pop() ?? "";
  return /^\d+$/.test(tail) ? tail : "";
}

export function readShopifyAdminConfig(): ShopifyAdminConfig {
  const storeDomain = storeHost(readShopifyStoreDomain() ?? "");
  const adminToken = readShopifyAdminToken() ?? "";
  if (!storeDomain || !adminToken) {
    throw new ShopifyAdminError("Shopify Admin API requires SHOPIFY_STORE_DOMAIN and SHOPIFY_ADMIN_TOKEN.", 503);
  }
  return {
    storeDomain,
    adminToken,
    apiVersion: readShopifyApiVersion() ?? DEFAULT_API_VERSION,
  };
}

async function adminFetch(path: string, init: RequestInit = {}): Promise<unknown> {
  const config = readShopifyAdminConfig();
  const response = await fetch(`https://${config.storeDomain}/admin/api/${config.apiVersion}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": config.adminToken,
      ...init.headers,
    },
  });
  const text = await response.text();
  let payload: unknown = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text.slice(0, 500) };
  }
  if (!response.ok) {
    const body = asRecord(payload);
    throw new ShopifyAdminError(`Shopify Admin API ${response.status}: ${asString(body.errors) || response.statusText}`, response.status);
  }
  return payload;
}

async function graphql<T>(query: string, variables?: UnknownRecord): Promise<T> {
  const payload = await adminFetch("/graphql.json", {
    method: "POST",
    body: JSON.stringify({ query, variables }),
  });
  const record = asRecord(payload);
  const errors = Array.isArray(record.errors) ? record.errors : [];
  if (errors.length > 0) {
    const message = errors.map((error) => asString(asRecord(error).message)).filter(Boolean).join("; ");
    throw new ShopifyAdminError(`Shopify GraphQL error: ${message || "unknown error"}`);
  }
  return record.data as T;
}

export async function getShopInfo(): Promise<UnknownRecord> {
  const data = await graphql<{ shop: UnknownRecord }>(`query {
    shop { name email primaryDomain { host } plan { displayName partnerDevelopment } }
  }`);
  return data.shop;
}

export async function listProducts(limit = 20, search?: string): Promise<ShopifyAdminProduct[]> {
  const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
  const data = await graphql<{ products: { edges: Array<{ node: UnknownRecord }> } }>(`query($first: Int!, $query: String) {
    products(first: $first, query: $query) {
      edges { node { id title handle status variants(first: 10) { edges { node { sku price } } } } }
    }
  }`, { first: safeLimit, query: search || null });
  return (data.products?.edges ?? []).map(({ node }) => {
    const variants = asRecord(node.variants).edges;
    const firstVariant = Array.isArray(variants) ? asRecord(variants[0]) : {};
    const variantNode = asRecord(firstVariant.node);
    return {
      id: asString(node.id),
      title: asString(node.title),
      handle: asString(node.handle) || undefined,
      status: asString(node.status),
      sku: asString(variantNode.sku) || undefined,
      price: asString(variantNode.price) || undefined,
    };
  });
}

export async function ensureProduct(input: EnsureProductInput): Promise<ShopifyAdminProduct> {
  const title = input.title.trim();
  if (!title) {throw new ShopifyAdminError("Product title is required.", 400);}
  if (input.sku?.trim()) {
    const existing = await listProducts(10, `sku:${input.sku.trim()}`);
    const match = existing.find((product) => product.sku === input.sku!.trim());
    if (match) {return match;}
  }
  const productInput: UnknownRecord = { title, status: "ACTIVE" };
  if (input.sku?.trim() || input.price !== undefined) {
    productInput.variants = [{
      ...(input.sku?.trim() ? { sku: input.sku.trim() } : {}),
      ...(input.price !== undefined ? { price: input.price.toFixed(2) } : {}),
    }];
  }
  const data = await graphql<{ productCreate: { product: UnknownRecord | null; userErrors: Array<UnknownRecord> } }>(`mutation($input: ProductInput!) {
    productCreate(input: $input) { product { id title handle status variants(first: 1) { edges { node { sku price } } } } userErrors { field message } }
  }`, { input: productInput });
  const result = data.productCreate;
  if (result.userErrors?.length) {
    throw new ShopifyAdminError(result.userErrors.map((error) => asString(error.message)).filter(Boolean).join("; ") || "Shopify rejected product creation.", 422);
  }
  if (!result.product) {throw new ShopifyAdminError("Shopify created no product.");}
  const product = result.product;
  const variants = asRecord(product.variants).edges;
  const firstVariant = Array.isArray(variants) ? asRecord(variants[0]) : {};
  const variantNode = asRecord(firstVariant.node);
  return {
    id: asString(product.id),
    title: asString(product.title),
    handle: asString(product.handle) || undefined,
    status: asString(product.status),
    sku: asString(variantNode.sku) || undefined,
    price: asString(variantNode.price) || undefined,
  };
}

export async function listOrders(limit = 20, status = "any"): Promise<ShopifyAdminOrder[]> {
  const safeLimit = Math.max(1, Math.min(250, Math.floor(limit)));
  const query = new URLSearchParams({ limit: String(safeLimit), status, order: "created_at desc" });
  const payload = asRecord(await adminFetch(`/orders.json?${query.toString()}`));
  return Array.isArray(payload.orders) ? payload.orders as ShopifyAdminOrder[] : [];
}

export async function fulfillOrder(orderId: string, trackingNumber: string, carrier = "GLS"): Promise<UnknownRecord> {
  const id = numericId(orderId);
  if (!id) {throw new ShopifyAdminError("fulfill-order requires a numeric Shopify order id or gid.", 400);}
  if (!trackingNumber.trim()) {throw new ShopifyAdminError("trackingNumber is required.", 400);}
  const orderPayload = asRecord(await adminFetch(`/orders/${id}.json`));
  const order = asRecord(orderPayload.order);
  const lineItems = Array.isArray(order.line_items) ? order.line_items : [];
  if (!lineItems.length) {throw new ShopifyAdminError("The Shopify order has no line items.", 422);}
  const payload = await adminFetch(`/orders/${id}/fulfillments.json`, {
    method: "POST",
    body: JSON.stringify({ fulfillment: {
      tracking_number: trackingNumber.trim(),
      tracking_company: carrier.trim() || "GLS",
      notify_customer: false,
      line_items: lineItems.map((item) => ({ id: asRecord(item).id })),
    } }),
  });
  return asRecord(payload);
}
