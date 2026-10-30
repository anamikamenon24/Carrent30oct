export type ChargeStatus =
  | "pending"
  | "succeeded"
  | "failed"
  | "canceled"
  | "refunded"
  | "partially_refunded";

export type DepositStatus = "held" | "released" | "captured";

export interface Charge {
  id: string;
  amountCents: number;
  currency: string;
  status: ChargeStatus;
  refundedCents: number;
  failureReason?: string;
  metadata: Record<string, string>;
}

export interface DepositHold {
  id: string;
  amountCents: number;
  currency: string;
  status: DepositStatus;
  capturedCents: number;
  metadata: Record<string, string>;
}

export type PaymentEventType =
  | "charge.succeeded"
  | "charge.failed"
  | "charge.canceled"
  | "charge.refunded"
  | "deposit.held"
  | "deposit.released"
  | "deposit.captured";

export interface PaymentEvent {
  /** Stable per event. Duplicate deliveries share the same id, so handlers must dedupe on it. */
  id: string;
  type: PaymentEventType;
  createdAt: string;
  data: Charge | DepositHold;
}

export interface PaymentInput {
  amountCents: number;
  currency: string;
  /** Provider-specific payment method reference. */
  paymentMethod: string;
  idempotencyKey: string;
  metadata?: Record<string, string>;
}

/** The only payments surface the app may use. Implementations: fake (local), stripe (later). */
export interface PaymentProvider {
  readonly name: string;
  createCharge(input: PaymentInput): Promise<Charge>;
  /** Cancels a charge that has not completed yet. */
  cancelCharge(chargeId: string): Promise<Charge>;
  /** Refunds all of a charge, or `amountCents` of it. */
  refundCharge(chargeId: string, amountCents?: number): Promise<Charge>;
  holdDeposit(input: PaymentInput): Promise<DepositHold>;
  releaseDeposit(holdId: string): Promise<DepositHold>;
  /** Keeps all of a held deposit, or `amountCents` of it (e.g. for damage); the rest is released. */
  captureDeposit(holdId: string, amountCents?: number): Promise<DepositHold>;
  /** Verifies the signature and parses a webhook request body. Throws if it is not genuine. */
  parseWebhook(rawBody: string, headers: Headers): Promise<PaymentEvent>;
}
