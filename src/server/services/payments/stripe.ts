import { createHmac, timingSafeEqual } from "node:crypto";
import type { Charge, ChargeStatus, DepositHold, PaymentEvent, PaymentEventType, PaymentInput, PaymentProvider } from "./types";

/**
 * Stripe adapter, TEST MODE ONLY (PAYMENTS_PROVIDER=stripe). Uses the REST API with fetch (no SDK).
 * - Rental charges: PaymentIntents confirmed immediately (automatic capture).
 * - Security deposits: PaymentIntents with capture_method=manual (an authorisation hold);
 *   release = cancel, capture = capture with amount_to_capture (Stripe releases the rest).
 * - Webhooks: verified with the Stripe-Signature header and mapped to our PaymentEvent types.
 * Amounts are minor units (fils for AED). Wired up but not run until the owner provides test keys.
 */
export class UnsupportedWebhookEvent extends Error {
  constructor(readonly eventType: string) {
    super(`Ignoring unsupported webhook event ${eventType}`);
  }
}

interface StripePaymentIntent {
  id: string;
  object: "payment_intent";
  amount: number;
  amount_received: number;
  currency: string;
  status: string;
  capture_method: "automatic" | "automatic_async" | "manual";
  metadata: Record<string, string>;
  last_payment_error?: { code?: string; decline_code?: string; message?: string } | null;
  latest_charge?: string | { amount_refunded: number } | null;
}

type FormParams = Record<string, string | number | boolean | Record<string, string> | undefined>;

const API = "https://api.stripe.com/v1";
const TOLERANCE_SECONDS = 300;

function form(params: FormParams) {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    if (typeof v === "object") for (const [mk, mv] of Object.entries(v)) body.append(`${k}[${mk}]`, mv);
    else body.append(k, String(v));
  }
  return body;
}

export class StripePaymentProvider implements PaymentProvider {
  readonly name = "stripe";

  constructor(private readonly options: { secretKey: string; webhookSecret: string; fetch?: typeof fetch }) {
    if (!options.secretKey?.startsWith("sk_test_")) throw new Error("Only Stripe test-mode keys (sk_test_...) are allowed");
  }

  private async call<T>(path: string, params: FormParams = {}, idempotencyKey?: string): Promise<T> {
    const res = await (this.options.fetch ?? fetch)(`${API}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.options.secretKey}`,
        "content-type": "application/x-www-form-urlencoded",
        ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
      },
      body: form(params),
    });
    const json = (await res.json()) as T & { error?: { message: string; payment_intent?: StripePaymentIntent } };
    if (!res.ok) {
      // A declined card returns 402 with the failed PaymentIntent attached.
      if (json.error?.payment_intent) return json.error.payment_intent as T;
      throw new Error(`Stripe ${path} failed: ${json.error?.message ?? res.status}`);
    }
    return json;
  }

  private async retrieve(id: string) {
    const res = await (this.options.fetch ?? fetch)(`${API}/payment_intents/${id}?expand[]=latest_charge`, {
      headers: { authorization: `Bearer ${this.options.secretKey}` },
    });
    if (!res.ok) throw new Error(`Stripe retrieve ${id} failed: ${res.status}`);
    return (await res.json()) as StripePaymentIntent;
  }

  private intent(input: PaymentInput, manual: boolean): FormParams {
    return {
      amount: input.amountCents,
      currency: input.currency.toLowerCase(),
      payment_method: input.paymentMethod,
      confirm: true,
      capture_method: manual ? "manual" : "automatic",
      "automatic_payment_methods[enabled]": true,
      "automatic_payment_methods[allow_redirects]": "never",
      metadata: input.metadata ?? {},
    };
  }

  async createCharge(input: PaymentInput): Promise<Charge> {
    return toCharge(await this.call<StripePaymentIntent>("/payment_intents", this.intent(input, false), input.idempotencyKey));
  }

  async cancelCharge(chargeId: string): Promise<Charge> {
    return toCharge(await this.call<StripePaymentIntent>(`/payment_intents/${chargeId}/cancel`));
  }

  async refundCharge(chargeId: string, amountCents?: number): Promise<Charge> {
    await this.call("/refunds", { payment_intent: chargeId, amount: amountCents });
    return toCharge(await this.retrieve(chargeId));
  }

  async holdDeposit(input: PaymentInput): Promise<DepositHold> {
    const pi = await this.call<StripePaymentIntent>("/payment_intents", this.intent(input, true), input.idempotencyKey);
    if (pi.status !== "requires_capture") {
      throw new Error(`Deposit hold declined: ${pi.last_payment_error?.decline_code ?? pi.last_payment_error?.code ?? pi.status}`);
    }
    return toHold(pi);
  }

  async releaseDeposit(holdId: string): Promise<DepositHold> {
    return toHold(await this.call<StripePaymentIntent>(`/payment_intents/${holdId}/cancel`));
  }

  async captureDeposit(holdId: string, amountCents?: number): Promise<DepositHold> {
    return toHold(await this.call<StripePaymentIntent>(`/payment_intents/${holdId}/capture`, { amount_to_capture: amountCents }));
  }

  async parseWebhook(rawBody: string, headers: Headers): Promise<PaymentEvent> {
    if (!verifyStripeSignature(rawBody, headers.get("stripe-signature"), this.options.webhookSecret)) {
      throw new Error("Invalid webhook signature");
    }
    const event = JSON.parse(rawBody) as { id: string; type: string; created: number; data: { object: StripePaymentIntent } };
    const pi = event.data.object;
    const manual = pi.object === "payment_intent" && pi.capture_method === "manual";
    let type: PaymentEventType;
    let data: Charge | DepositHold;
    switch (event.type) {
      case "payment_intent.succeeded":
        [type, data] = manual ? ["deposit.captured", toHold(pi)] : ["charge.succeeded", toCharge(pi)];
        break;
      case "payment_intent.payment_failed":
        if (manual) throw new UnsupportedWebhookEvent(event.type);
        [type, data] = ["charge.failed", toCharge(pi)];
        break;
      case "payment_intent.canceled":
        [type, data] = manual ? ["deposit.released", toHold(pi)] : ["charge.canceled", toCharge(pi)];
        break;
      case "payment_intent.amount_capturable_updated":
        [type, data] = ["deposit.held", toHold(pi)];
        break;
      default:
        // Refunds are recorded from the API response (charge.refunded carries a Charge, not an intent).
        throw new UnsupportedWebhookEvent(event.type);
    }
    return { id: event.id, type, createdAt: new Date(event.created * 1000).toISOString(), data };
  }
}

export function verifyStripeSignature(rawBody: string, header: string | null, secret: string, now = Date.now()) {
  const parts = (header ?? "").split(",").map((p) => p.split("=", 2) as [string, string]);
  const t = Number(parts.find(([k]) => k === "t")?.[1]);
  const signatures = parts.filter(([k]) => k === "v1").map(([, v]) => v);
  if (!Number.isFinite(t) || !signatures.length || Math.abs(now / 1000 - t) > TOLERANCE_SECONDS) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest();
  return signatures.some((s) => {
    const given = Buffer.from(s, "hex");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

function chargeStatus(pi: StripePaymentIntent, refunded: number): ChargeStatus {
  switch (pi.status) {
    case "succeeded":
      return refunded === 0 ? "succeeded" : refunded >= pi.amount_received ? "refunded" : "partially_refunded";
    case "canceled":
      return "canceled";
    case "requires_payment_method":
      return "failed";
    default:
      return "pending";
  }
}

function toCharge(pi: StripePaymentIntent): Charge {
  const refunded = typeof pi.latest_charge === "object" && pi.latest_charge ? pi.latest_charge.amount_refunded : 0;
  const status = chargeStatus(pi, refunded);
  return {
    id: pi.id,
    amountCents: pi.amount,
    currency: pi.currency,
    status,
    refundedCents: refunded,
    failureReason: status === "failed" ? (pi.last_payment_error?.decline_code ?? pi.last_payment_error?.code ?? "failed") : undefined,
    metadata: pi.metadata ?? {},
  };
}

function toHold(pi: StripePaymentIntent): DepositHold {
  return {
    id: pi.id,
    amountCents: pi.amount,
    currency: pi.currency,
    status: pi.status === "succeeded" ? "captured" : pi.status === "canceled" ? "released" : "held",
    capturedCents: pi.amount_received ?? 0,
    metadata: pi.metadata ?? {},
  };
}
