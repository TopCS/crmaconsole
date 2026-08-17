import {
  ensureProduct,
  fulfillOrder,
  getShopInfo,
  listOrders,
  listProducts,
} from "@/lib/shopify-admin";
import { isPhoneWebhookAuthorized } from "@/lib/phone-webhook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ACTIONS = ["store-info", "list-products", "ensure-product", "list-orders", "fulfill-order"] as const;
type Action = (typeof ACTIONS)[number];
type Body = Record<string, unknown>;

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {return value;}
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function errorResponse(error: unknown): Response {
  const status = error && typeof error === "object" && "status" in error && typeof error.status === "number"
    ? error.status
    : 500;
  return Response.json({ error: error instanceof Error ? error.message : "Shopify Admin API request failed." }, { status });
}

export async function POST(req: Request): Promise<Response> {
  if (!isPhoneWebhookAuthorized(req)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const action = stringValue(body.action) as Action | undefined;
  if (!action || !ACTIONS.includes(action)) {
    return Response.json({ error: `Unknown action. Use: ${ACTIONS.join(", ")}.` }, { status: 400 });
  }

  try {
    switch (action) {
      case "store-info":
        return Response.json({ ok: true, shop: await getShopInfo() });
      case "list-products":
        return Response.json({ ok: true, products: await listProducts(numberValue(body.limit) ?? 20, stringValue(body.query)) });
      case "ensure-product": {
        const title = stringValue(body.title);
        if (!title) {return Response.json({ error: "title is required." }, { status: 400 });}
        if (body.confirm !== true) {
          return Response.json({ error: "Creating a Shopify product requires confirm: true.", needsConfirmation: true }, { status: 400 });
        }
        return Response.json({ ok: true, product: await ensureProduct({
          title,
          sku: stringValue(body.sku),
          price: numberValue(body.price),
        }) }, { status: 201 });
      }
      case "list-orders":
        return Response.json({ ok: true, orders: await listOrders(numberValue(body.limit) ?? 20, stringValue(body.status) ?? "any") });
      case "fulfill-order": {
        const orderId = stringValue(body.orderId);
        const trackingNumber = stringValue(body.trackingNumber);
        if (!orderId || !trackingNumber) {
          return Response.json({ error: "orderId and trackingNumber are required." }, { status: 400 });
        }
        if (body.confirm !== true) {
          return Response.json({ error: "Creating a fulfillment requires confirm: true.", needsConfirmation: true }, { status: 400 });
        }
        return Response.json({ ok: true, fulfillment: await fulfillOrder(orderId, trackingNumber, stringValue(body.carrier) ?? "GLS") });
      }
    }
  } catch (error) {
    return errorResponse(error);
  }
}
