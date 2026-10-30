import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type {
  Charge,
  DepositHold,
  PaymentEvent,
  PaymentEventType,
  PaymentInput,
  PaymentProvider,
} from "./types";

/**
 * Test payment methods. The outcome of a charge or hold is decided by which one you pass.
 */
export const FAKE_PAYMENT_METHODS = {
  success: "pm_fake_success",
  fail: "pm_fake_fail",
  /** The customer abandons checkout: the charge ends up canceled. */
  cancel: "pm_fake_cancel",
  /** The charge stays pending until cancelCharge is called (or it is left alone). */
  pending: "pm_fake_pending",
} as const;

export const FAKE_SIGNATURE_HEADER = "x-fake-payments-signature";
const SIGNATURE_TOLERANCE_SECONDS = 300;

export function signFakeWebhook(rawBody: string, secret: string, timestamp = Math.floor(Date.now() / 1000)) {
  const mac = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  return `t=${timestamp},v1=${mac}`;
}

export function verifyFakeWebhook(rawBody: string, header: string | null, secret: string, now = Date.now()) {
  const parts = Object.fromEntries((header ?? "").split(",").map((p) => p.split("=", 2)));
  const timestamp = Number(parts.t);
  if (!parts.v1 || !Number.isFinite(timestamp)) return false;
  if (Math.abs(now / 1000 - timestamp) > SIGNATURE_TOLERANCE_SECONDS) return false;
  const expected = Buffer.from(signFakeWebhook(rawBody, secret, timestamp).split("v1=")[1], "hex");
  const given = Buffer.from(parts.v1, "hex");
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function makeFakeEvent(type: PaymentEventType, data: Charge | DepositHold): PaymentEvent {
  return { id: `evt_fake_${randomUUID()}`, type, createdAt: new Date().toISOString(), data };
}

interface FakeOptions {
  webhookSecret: string;
  /** Where webhooks are POSTed. If unset, events are only recorded in `sentEvents`. */
  webhookUrl?: string;
  /** Deliver every webhook twice, to exercise idempotent handling. */
  duplicateWebhooks?: boolean;
  fetch?: typeof fetch;
}

interface FakeState {
  charges: Map<string, Charge>;
  holds: Map<string, DepositHold>;
  byIdempotencyKey: Map<string, Charge | DepositHold>;
}

/** In-memory fake payment provider. State lives for the life of the process. */
export class FakePaymentProvider implements PaymentProvider {
  readonly name = "fake";
  readonly sentEvents: PaymentEvent[] = [];
  private state: FakeState = { charges: new Map(), holds: new Map(), byIdempotencyKey: new Map() };

  constructor(private readonly options: FakeOptions) {}

  async createCharge(input: PaymentInput): Promise<Charge> {
    const existing = this.state.byIdempotencyKey.get(input.idempotencyKey);
    if (existing) return structuredClone(existing as Charge);

    const charge: Charge = {
      id: `ch_fake_${randomUUID()}`,
      amountCents: assertAmount(input.amountCents),
      currency: input.currency.toLowerCase(),
      status: "succeeded",
      refundedCents: 0,
      metadata: input.metadata ?? {},
    };
    switch (input.paymentMethod) {
      case FAKE_PAYMENT_METHODS.success:
        break;
      case FAKE_PAYMENT_METHODS.fail:
        charge.status = "failed";
        charge.failureReason = "card_declined";
        break;
      case FAKE_PAYMENT_METHODS.cancel:
        charge.status = "canceled";
        break;
      case FAKE_PAYMENT_METHODS.pending:
        charge.status = "pending";
        break;
      default:
        throw new Error(`Unknown fake payment method: ${input.paymentMethod}`);
    }
    this.state.charges.set(charge.id, charge);
    this.state.byIdempotencyKey.set(input.idempotencyKey, charge);
    if (charge.status !== "pending") await this.emit(`charge.${charge.status}` as PaymentEventType, charge);
    return structuredClone(charge);
  }

  async cancelCharge(chargeId: string): Promise<Charge> {
    const charge = this.getCharge(chargeId);
    if (charge.status !== "pending") throw new Error(`Cannot cancel a ${charge.status} charge`);
    charge.status = "canceled";
    await this.emit("charge.canceled", charge);
    return structuredClone(charge);
  }

  async refundCharge(chargeId: string, amountCents?: number): Promise<Charge> {
    const charge = this.getCharge(chargeId);
    if (charge.status !== "succeeded" && charge.status !== "partially_refunded") {
      throw new Error(`Cannot refund a ${charge.status} charge`);
    }
    const remaining = charge.amountCents - charge.refundedCents;
    const amount = amountCents === undefined ? remaining : assertAmount(amountCents);
    if (amount > remaining) throw new Error("Refund exceeds the remaining charge amount");
    charge.refundedCents += amount;
    charge.status = charge.refundedCents === charge.amountCents ? "refunded" : "partially_refunded";
    await this.emit("charge.refunded", charge);
    return structuredClone(charge);
  }

  async holdDeposit(input: PaymentInput): Promise<DepositHold> {
    const existing = this.state.byIdempotencyKey.get(input.idempotencyKey);
    if (existing) return structuredClone(existing as DepositHold);
    if (input.paymentMethod !== FAKE_PAYMENT_METHODS.success) {
      throw new Error("Deposit hold declined: card_declined");
    }
    const hold: DepositHold = {
      id: `dh_fake_${randomUUID()}`,
      amountCents: assertAmount(input.amountCents),
      currency: input.currency.toLowerCase(),
      status: "held",
      capturedCents: 0,
      metadata: input.metadata ?? {},
    };
    this.state.holds.set(hold.id, hold);
    this.state.byIdempotencyKey.set(input.idempotencyKey, hold);
    await this.emit("deposit.held", hold);
    return structuredClone(hold);
  }

  async releaseDeposit(holdId: string): Promise<DepositHold> {
    const hold = this.getHold(holdId);
    hold.status = "released";
    await this.emit("deposit.released", hold);
    return structuredClone(hold);
  }

  async captureDeposit(holdId: string, amountCents?: number): Promise<DepositHold> {
    const hold = this.getHold(holdId);
    const amount = amountCents === undefined ? hold.amountCents : assertAmount(amountCents);
    if (amount > hold.amountCents) throw new Error("Capture exceeds the held amount");
    hold.status = "captured";
    hold.capturedCents = amount;
    await this.emit("deposit.captured", hold);
    return structuredClone(hold);
  }

  async parseWebhook(rawBody: string, headers: Headers): Promise<PaymentEvent> {
    if (!verifyFakeWebhook(rawBody, headers.get(FAKE_SIGNATURE_HEADER), this.options.webhookSecret)) {
      throw new Error("Invalid webhook signature");
    }
    return JSON.parse(rawBody) as PaymentEvent;
  }

  /** Re-sends an already sent event with the same id, as real providers sometimes do. */
  async resendEvent(eventId: string): Promise<void> {
    const event = this.sentEvents.find((e) => e.id === eventId);
    if (!event) throw new Error(`No such event: ${eventId}`);
    await this.deliver(event);
  }

  private getCharge(id: string) {
    const charge = this.state.charges.get(id);
    if (!charge) throw new Error(`No such charge: ${id}`);
    return charge;
  }

  private getHold(id: string) {
    const hold = this.state.holds.get(id);
    if (!hold) throw new Error(`No such deposit hold: ${id}`);
    if (hold.status !== "held") throw new Error(`Deposit hold is already ${hold.status}`);
    return hold;
  }

  private async emit(type: PaymentEventType, data: Charge | DepositHold) {
    const event = makeFakeEvent(type, structuredClone(data));
    this.sentEvents.push(event);
    await this.deliver(event);
    if (this.options.duplicateWebhooks) await this.deliver(event);
  }

  private async deliver(event: PaymentEvent) {
    const { webhookUrl, webhookSecret } = this.options;
    if (!webhookUrl) return;
    const body = JSON.stringify(event);
    try {
      await (this.options.fetch ?? fetch)(webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json", [FAKE_SIGNATURE_HEADER]: signFakeWebhook(body, webhookSecret) },
        body,
      });
    } catch (err) {
      // Like a real provider, a failed delivery does not fail the payment operation.
      console.warn(`[fake-payments] webhook delivery failed for ${event.id}:`, err);
    }
  }
}

function assertAmount(amountCents: number) {
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error("Amount must be a positive integer of cents");
  return amountCents;
}
