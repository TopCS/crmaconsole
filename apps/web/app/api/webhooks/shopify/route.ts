/**
 * POST /api/webhooks/shopify — e-commerce touchpoint ingestion.
 *
 * Receives Shopify store webhooks (orders/create, order/fulfilled) and turns
 * them into CRM records: resolve/create the Person (comparing email → phone →
 * name, gap-filling), record the `Purchase` interaction, materialize the
 * `order` (with courier/tracking from fulfilment). A purchase never writes
 * marketing consent — that stays an explicit operator action (GDPR).
 *
 * Auth (one of):
 *  - Shopify HMAC: `X-Shopify-Hmac-Sha256` verified against the app API
 *    secret (`SHOPIFY_API_SECRET` or the Integrations UI config). Preferred.
 *  - `?token=` equal to the console phone webhook secret — fallback/dev
 *    (lets the simulator work before the Shopify app secret is wired).
 *
 * Idempotent by Shopify order id (stored in the interaction Properties;
 * duplicate deliveries return the already-recorded event).
 */

import { timingSafeEqual } from "node:crypto";
import {
  applyShopifyFulfillment,
  ingestShopifyOrder,
  mapShopifyOrder,
  verifyShopifyHmac,
} from "@/lib/shopify";
import { readShopifyHmacSecret } from "@/lib/shopify-config";
import { readPhoneWebhookSecret } from "@/lib/phone-webhook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TOPICS: Record<string, true> = {
  "orders/create": true,
  "orders/paid": true,
  "order/fulfilled": true,
};

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf-8");
  const bBuf = Buffer.from(b, "utf-8");
  if (aBuf.length !== bBuf.length) {return false;}
  return timingSafeEqual(aBuf, bBuf);
}

/** `?token=` matches the console webhook secret (constant time). */
function tokenQueryMatches(req: Request): boolean {
  const secret = readPhoneWebhookSecret();
  if (!secret) {return false;}
  const presented = new URL(req.url).searchParams.get("token");
  return typeof presented === "string" && presented.length > 0 && safeEqual(presented, secret);
}

/** Verify HMAC (preferred) or fall back to the `?token=` shared secret. */
function authorized(req: Request, rawBody: string): boolean {
  const secret = readShopifyHmacSecret();
  if (secret) {
    return verifyShopifyHmac(rawBody, req.headers.get("x-shopify-hmac-sha256"), secret);
  }
  return tokenQueryMatches(req);
}

export async function POST(req: Request): Promise<Response> {
  const raw = await req.text();
  if (!raw) {return jsonError("Empty body.", 400);}

  if (!authorized(req, raw)) {
    return jsonError("Unauthorized", 401);
  }

  const topic = req.headers.get("x-shopify-topic") ?? "";
  if (!TOPICS[topic]) {
    return jsonError(`Unsupported Shopify topic "${topic}".`, 400);
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return jsonError("Invalid JSON body.", 400);
  }

  const data = mapShopifyOrder(body);
  if (!data) {
    return jsonError("Payload is not a valid Shopify order.", 400);
  }

  try {
    if (topic === "order/fulfilled") {
      const result = await applyShopifyFulfillment(data);
      return Response.json({ ok: true, ...result });
    }
    const result = await ingestShopifyOrder(data);
    return Response.json({ ok: true, ...result }, { status: 201 });
  } catch (err) {
    return jsonError(
      err instanceof Error ? err.message : "Failed to ingest Shopify order.",
      500,
    );
  }
}