import { handleSesNotification, type SesNotification } from "@/lib/campaigns";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/crm/campaigns/ses-webhook — SNS endpoint for SES event
 * notifications (bounces, complaints, deliveries).
 *
 * Wire-up in AWS: SES configuration set (or identity) → event publishing →
 * SNS topic → HTTPS subscription pointing at
 * `https://<your-public-host>/api/crm/campaigns/ses-webhook`.
 *
 * Handles the SNS SubscriptionConfirmation handshake automatically (fetches
 * the SubscribeURL once, when the topic is first subscribed).
 */
export async function POST(req: Request) {
  let payload: Record<string, unknown>;
  try {
    payload = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const type = req.headers.get("x-amz-sns-message-type");

  if (type === "SubscriptionConfirmation") {
    const subscribeUrl = payload.SubscribeURL;
    if (typeof subscribeUrl !== "string" || !subscribeUrl.startsWith("https://sns.")) {
      return Response.json({ error: "Invalid SubscribeURL." }, { status: 400 });
    }
    try {
      const res = await fetch(subscribeUrl);
      if (!res.ok) {throw new Error(`HTTP ${res.status}`);}
      return Response.json({ confirmed: true });
    } catch (err) {
      return Response.json(
        { error: err instanceof Error ? err.message : "Subscription confirmation failed." },
        { status: 502 },
      );
    }
  }

  if (type === "Notification") {
    const raw = payload.Message;
    if (typeof raw !== "string") {
      return Response.json({ error: "Missing Message." }, { status: 400 });
    }
    let message: SesNotification;
    try {
      message = JSON.parse(raw) as SesNotification;
    } catch {
      return Response.json({ error: "Message is not valid JSON." }, { status: 400 });
    }
    const handled = await handleSesNotification(message);
    return Response.json({ handled });
  }

  return Response.json({ error: "Unsupported SNS message type." }, { status: 400 });
}
