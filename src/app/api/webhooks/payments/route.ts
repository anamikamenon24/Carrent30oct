import { log } from "@/server/audit";
import { processPaymentEvent } from "@/server/reservations/payments";
import { getPayments } from "@/server/services";
import { UnsupportedWebhookEvent } from "@/server/services/payments/stripe";

export const maxDuration = 30;

/**
 * Payment-provider webhooks. The body is verified with PAYMENTS_WEBHOOK_SECRET by the provider adapter
 * (fake: x-fake-payments-signature; Stripe: Stripe-Signature). Each event id is processed once:
 * duplicate deliveries answer 200 { duplicate: true } and change nothing.
 * 400 = not genuine (provider should not retry); 500 = temporary failure (provider retries).
 */
export async function POST(req: Request) {
  const raw = await req.text();
  const provider = getPayments();
  let event;
  try {
    event = await provider.parseWebhook(raw, req.headers);
  } catch (err) {
    if (err instanceof UnsupportedWebhookEvent) return Response.json({ ignored: err.eventType });
    log("warn", "webhook.rejected", { provider: provider.name, error: String(err) });
    return Response.json({ error: "Invalid webhook" }, { status: 400 });
  }
  try {
    const result = await processPaymentEvent(provider.name, event);
    return Response.json(result);
  } catch (err) {
    log("error", "webhook.failed", { provider: provider.name, eventId: event.id, error: String(err) });
    return Response.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}
