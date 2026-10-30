/**
 * Step 8 (confirm only after a verified payment AND a deposit authorisation), idempotent webhook handling,
 * and money settlement (refunds / deposit releases) for expired and cancelled reservations.
 *
 * Rule: never hold a database transaction open while calling the payment provider. The provider may send
 * a webhook to this app while the call is in flight, and that webhook needs the same rows.
 * Refunds and deposit releases are "claimed" in the database first (compare-and-set), then sent to the
 * provider, and rolled back if the provider call fails, so two workers can never refund the same money twice.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, type DbOrTx } from "@/server/db";
import {
  deposits,
  driverProfiles,
  payments,
  reservations,
  vehicleCategories,
  vehicles,
  webhookEvents,
} from "@/server/db/schema";
import { audit, log } from "@/server/audit";
import { getPayments } from "@/server/services";
import type { Charge, DepositHold, PaymentEvent } from "@/server/services/payments/types";
import { isUuid } from "@/server/data/catalog";
import { pgCode, PG_UNIQUE_VIOLATION, ReservationError } from "./errors";
import type { ReservationRow } from "./holds";

type PaymentRow = typeof payments.$inferSelect;
type DepositRow = typeof deposits.$inferSelect;
type PaymentStatus = PaymentRow["status"];
type DepositStatus = DepositRow["status"];

// ---------------------------------------------------------------------------------------------
// Status mapping (monotonic: a late or duplicate event can never move a status backwards)
// ---------------------------------------------------------------------------------------------

const PAYMENT_RANK: Record<PaymentStatus, number> = {
  PENDING: 0,
  FAILED: 1,
  CANCELLED: 1,
  SUCCEEDED: 1,
  PARTIALLY_REFUNDED: 2,
  REFUNDED: 3,
};
const DEPOSIT_RANK: Record<DepositStatus, number> = {
  PENDING: 0,
  FAILED: 1,
  HELD: 1,
  RELEASED: 2,
  PARTIALLY_CAPTURED: 2,
  CAPTURED: 2,
};

function chargeStatus(c: Charge): PaymentStatus {
  return ({
    pending: "PENDING",
    succeeded: "SUCCEEDED",
    failed: "FAILED",
    canceled: "CANCELLED",
    partially_refunded: "PARTIALLY_REFUNDED",
    refunded: "REFUNDED",
  } as const)[c.status];
}

function holdStatus(h: DepositHold): DepositStatus {
  if (h.status === "held") return "HELD";
  if (h.status === "released") return "RELEASED";
  return h.capturedCents >= h.amountCents ? "CAPTURED" : "PARTIALLY_CAPTURED";
}

/** Applies a provider charge snapshot to our payment row, never moving backwards. */
export async function applyChargeSnapshot(conn: DbOrTx, paymentId: string, charge: Charge) {
  const run = async (tx: DbOrTx) => {
    const [p] = await tx.select().from(payments).where(eq(payments.id, paymentId)).for("update");
    if (!p) return null;
    const next = chargeStatus(charge);
    const refunded = Math.min(p.amountFils, Math.max(p.refundedFils, charge.refundedCents));
    let status: PaymentStatus = PAYMENT_RANK[next] >= PAYMENT_RANK[p.status] ? next : p.status;
    if (refunded > 0 && refunded >= p.amountFils) status = "REFUNDED";
    else if (refunded > 0) status = "PARTIALLY_REFUNDED";
    if (status === p.status && refunded === p.refundedFils && p.providerChargeId === charge.id) return p;
    const [row] = await tx
      .update(payments)
      .set({
        status,
        refundedFils: refunded,
        providerChargeId: p.providerChargeId ?? charge.id,
        failureReason: next === "FAILED" ? (charge.failureReason ?? "declined") : p.failureReason,
      })
      .where(eq(payments.id, paymentId))
      .returning();
    return row;
  };
  return "transaction" in conn && conn === db ? db.transaction(run) : run(conn);
}

/** Applies a provider hold snapshot to our deposit row, never moving backwards. */
export async function applyHoldSnapshot(conn: DbOrTx, depositId: string, hold: DepositHold, now = new Date()) {
  const run = async (tx: DbOrTx) => {
    const [d] = await tx.select().from(deposits).where(eq(deposits.id, depositId)).for("update");
    if (!d) return null;
    const next = holdStatus(hold);
    if (DEPOSIT_RANK[next] < DEPOSIT_RANK[d.status] || (next === d.status && d.providerHoldId === hold.id)) return d;
    const [row] = await tx
      .update(deposits)
      .set({
        status: next,
        providerHoldId: d.providerHoldId ?? hold.id,
        capturedFils: next === "RELEASED" ? d.capturedFils : Math.min(d.amountFils, hold.capturedCents),
        heldAt: next === "HELD" ? (d.heldAt ?? now) : d.heldAt,
        releasedAt: next === "RELEASED" ? (d.releasedAt ?? now) : d.releasedAt,
        capturedAt: next === "CAPTURED" || next === "PARTIALLY_CAPTURED" ? (d.capturedAt ?? now) : d.capturedAt,
      })
      .where(eq(deposits.id, depositId))
      .returning();
    return row;
  };
  return conn === db ? db.transaction(run) : run(conn);
}

// ---------------------------------------------------------------------------------------------
// Vehicle status
// ---------------------------------------------------------------------------------------------

/**
 * Recomputes AVAILABLE / RESERVED / ON_RENT from the vehicle's reservations. MAINTENANCE and RETIRED
 * are set by staff and left alone.
 */
export async function refreshVehicleStatus(conn: DbOrTx, vehicleId: string, now: Date) {
  await conn.execute(sql`
    update vehicles set status = case
        when exists (select 1 from reservations r where r.vehicle_id = vehicles.id and r.status = 'PICKED_UP') then 'ON_RENT'
        when exists (select 1 from reservations r where r.vehicle_id = vehicles.id and r.status = 'CONFIRMED'
                     and r.return_at > ${now.toISOString()}::timestamptz) then 'RESERVED'
        else 'AVAILABLE' end::vehicle_status,
      updated_at = now()
    where id = ${vehicleId}::uuid and status in ('AVAILABLE', 'RESERVED', 'ON_RENT')`);
}

// ---------------------------------------------------------------------------------------------
// Confirmation
// ---------------------------------------------------------------------------------------------

export type ConfirmOutcome = "CONFIRMED" | "PENDING" | "EXPIRED" | ReservationRow["status"];

/**
 * Confirms a PENDING reservation if its hold is still valid, the rental charge succeeded and the deposit
 * is held. Expires it if the hold has lapsed. Safe to call any number of times.
 */
export async function tryConfirmReservation(reservationId: string, now = new Date()): Promise<ConfirmOutcome> {
  return db.transaction(async (tx) => {
    const [r] = await tx.select().from(reservations).where(eq(reservations.id, reservationId)).for("update");
    if (!r) throw new ReservationError("NOT_FOUND", "Reservation not found");
    if (r.status !== "PENDING") return r.status;
    if (r.holdExpiresAt && r.holdExpiresAt <= now) {
      await tx.update(reservations).set({ status: "EXPIRED", expiredAt: now }).where(eq(reservations.id, r.id));
      await audit(tx, { action: "reservation.expired", entityType: "reservation", entityId: r.id, data: { at: "confirm" } });
      return "EXPIRED";
    }
    const [paid] = await tx
      .select({ id: payments.id })
      .from(payments)
      .where(
        and(
          eq(payments.reservationId, r.id),
          eq(payments.kind, "RENTAL"),
          eq(payments.status, "SUCCEEDED"),
          eq(payments.amountFils, r.totalFils),
        ),
      )
      .limit(1);
    const [held] =
      r.depositFils === 0
        ? [{ id: null }]
        : await tx
            .select({ id: deposits.id })
            .from(deposits)
            .where(and(eq(deposits.reservationId, r.id), eq(deposits.status, "HELD"), sql`${deposits.amountFils} >= ${r.depositFils}`))
            .limit(1);
    if (!paid || !held) return "PENDING";
    await tx
      .update(reservations)
      .set({ status: "CONFIRMED", confirmedAt: now, holdExpiresAt: null })
      .where(eq(reservations.id, r.id));
    await refreshVehicleStatus(tx, r.vehicleId, now);
    await audit(tx, {
      actorUserId: r.userId,
      action: "reservation.confirmed",
      entityType: "reservation",
      entityId: r.id,
      data: { paymentId: paid.id, depositId: held.id },
    });
    log("info", "reservation.confirmed", { reservationId: r.id });
    return "CONFIRMED";
  });
}

// ---------------------------------------------------------------------------------------------
// Paying for a reservation
// ---------------------------------------------------------------------------------------------

export interface PayReservationInput {
  reservationId: string;
  userId: string;
  /** Provider payment-method reference (fake provider: FAKE_PAYMENT_METHODS.*; Stripe: pm_...). */
  paymentMethod: string;
  /** One per checkout attempt; retrying the same attempt (double click, network retry) reuses it. */
  idempotencyKey: string;
  now?: Date;
}

export type PayReservationResult =
  | { status: "CONFIRMED"; reservationId: string; reference: string }
  /** The charge was declined or cancelled. The hold remains until it expires; retry with a new key. */
  | { status: "PAYMENT_FAILED"; reservationId: string; reason: string }
  /** The charge went through but the deposit hold was declined. Retrying (new key) will not charge again. */
  | { status: "DEPOSIT_FAILED"; reservationId: string; reason: string }
  /** The provider has not finished yet; the reservation is confirmed by webhook when it does. */
  | { status: "PROCESSING"; reservationId: string };

/** Checks the driver profile requirements and links it to the reservation. */
async function requireEligibleDriver(r: ReservationRow) {
  const [row] = await db
    .select({ profile: driverProfiles, minAge: vehicleCategories.minDriverAge })
    .from(vehicles)
    .innerJoin(vehicleCategories, eq(vehicleCategories.id, vehicles.categoryId))
    .leftJoin(driverProfiles, eq(driverProfiles.userId, r.userId))
    .where(eq(vehicles.id, r.vehicleId));
  const p = row?.profile;
  if (!p) throw new ReservationError("DRIVER_PROFILE_REQUIRED", "Add your driver details before paying");
  if (!p.licenceFileKey) throw new ReservationError("DRIVER_PROFILE_REQUIRED", "Upload your driving licence before paying");
  const returnDate = r.returnAt.toISOString().slice(0, 10);
  if (p.licenceExpiresOn < returnDate) {
    throw new ReservationError("DRIVER_NOT_ELIGIBLE", "Your driving licence expires before the end of the rental");
  }
  const dob = new Date(`${p.dateOfBirth}T00:00:00Z`);
  const minAgeDate = new Date(Date.UTC(dob.getUTCFullYear() + row.minAge, dob.getUTCMonth(), dob.getUTCDate()));
  if (minAgeDate > r.pickupAt) {
    throw new ReservationError("DRIVER_NOT_ELIGIBLE", `Drivers must be at least ${row.minAge} for this vehicle category`);
  }
  if (r.driverProfileId !== p.id) await db.update(reservations).set({ driverProfileId: p.id }).where(eq(reservations.id, r.id));
}

async function getOrCreatePayment(r: ReservationRow, key: string, provider: string): Promise<PaymentRow> {
  // A charge that already went through (e.g. deposit failed on an earlier attempt) is reused, not repeated.
  const [succeeded] = await db
    .select()
    .from(payments)
    .where(and(eq(payments.reservationId, r.id), eq(payments.kind, "RENTAL"), eq(payments.status, "SUCCEEDED"), eq(payments.amountFils, r.totalFils)))
    .limit(1);
  if (succeeded) return succeeded;
  await db
    .insert(payments)
    .values({ reservationId: r.id, kind: "RENTAL", amountFils: r.totalFils, provider, idempotencyKey: key })
    .onConflictDoNothing({ target: payments.idempotencyKey });
  const [p] = await db.select().from(payments).where(eq(payments.idempotencyKey, key));
  if (p.reservationId !== r.id) throw new ReservationError("IDEMPOTENCY_CONFLICT", "This payment key was already used");
  return p;
}

async function getOrCreateDeposit(r: ReservationRow, key: string, provider: string): Promise<DepositRow> {
  const [live] = await db
    .select()
    .from(deposits)
    .where(and(eq(deposits.reservationId, r.id), inArray(deposits.status, ["PENDING", "HELD"])))
    .limit(1);
  if (live) return live;
  try {
    const [d] = await db
      .insert(deposits)
      .values({ reservationId: r.id, amountFils: r.depositFils, provider, idempotencyKey: key })
      .onConflictDoNothing({ target: deposits.idempotencyKey })
      .returning();
    if (d) return d;
  } catch (err) {
    if (pgCode(err) !== PG_UNIQUE_VIOLATION) throw err; // a concurrent attempt created the live deposit
  }
  const [again] = await db
    .select()
    .from(deposits)
    .where(and(eq(deposits.reservationId, r.id), inArray(deposits.status, ["PENDING", "HELD"])))
    .limit(1);
  if (again) return again;
  const [byKey] = await db.select().from(deposits).where(eq(deposits.idempotencyKey, key));
  if (byKey?.reservationId !== r.id) throw new ReservationError("IDEMPOTENCY_CONFLICT", "This payment key was already used");
  return byKey;
}

/**
 * Charges the reservation total and places the security-deposit hold, then confirms the reservation.
 * Idempotent: the same idempotencyKey never charges twice; a CONFIRMED reservation returns CONFIRMED.
 * Throws ReservationError: NOT_FOUND (also for other users' reservations), HOLD_EXPIRED, INVALID_STATE,
 * DRIVER_PROFILE_REQUIRED, DRIVER_NOT_ELIGIBLE, VALIDATION, PROVIDER_ERROR.
 */
export async function payReservation(input: PayReservationInput): Promise<PayReservationResult> {
  const now = input.now ?? new Date();
  if (!isUuid(input.reservationId)) throw new ReservationError("NOT_FOUND", "Reservation not found");
  if (typeof input.idempotencyKey !== "string" || input.idempotencyKey.length < 8 || input.idempotencyKey.length > 180) {
    throw new ReservationError("VALIDATION", "A request key of 8-180 characters is required");
  }
  if (!input.paymentMethod) throw new ReservationError("VALIDATION", "Choose a payment method");

  const [r] = await db.select().from(reservations).where(eq(reservations.id, input.reservationId));
  if (!r || r.userId !== input.userId) throw new ReservationError("NOT_FOUND", "Reservation not found");
  const done = { status: "CONFIRMED", reservationId: r.id, reference: r.reference } as const;
  if (r.status === "CONFIRMED" || r.status === "PICKED_UP" || r.status === "RETURNED") return done;
  if (r.status === "EXPIRED" || (r.status === "PENDING" && r.holdExpiresAt! <= now)) {
    if (r.status === "PENDING") await tryConfirmReservation(r.id, now);
    throw new ReservationError("HOLD_EXPIRED", "Your hold on this vehicle has expired. Please search again.");
  }
  if (r.status !== "PENDING") throw new ReservationError("INVALID_STATE", `This reservation is ${r.status.toLowerCase()}`);
  await requireEligibleDriver(r);

  const provider = getPayments();
  const meta = (extra: Record<string, string>) => ({ reservationId: r.id, reference: r.reference, ...extra });

  // 1. Rental charge.
  let payment = await getOrCreatePayment(r, `${input.idempotencyKey}:charge`, provider.name);
  if (payment.status === "PENDING") {
    let charge: Charge;
    try {
      charge = await provider.createCharge({
        amountCents: payment.amountFils,
        currency: "AED",
        paymentMethod: input.paymentMethod,
        idempotencyKey: payment.idempotencyKey,
        metadata: meta({ paymentId: payment.id }),
      });
    } catch (err) {
      log("error", "payment.charge_error", { reservationId: r.id, error: String(err) });
      throw new ReservationError("PROVIDER_ERROR", "The payment could not be processed. Please try again.");
    }
    payment = (await applyChargeSnapshot(db, payment.id, charge)) ?? payment;
  }
  if (payment.status === "PENDING") return { status: "PROCESSING", reservationId: r.id };
  if (payment.status !== "SUCCEEDED") {
    return { status: "PAYMENT_FAILED", reservationId: r.id, reason: payment.failureReason ?? payment.status.toLowerCase() };
  }

  // 2. Security-deposit hold.
  if (r.depositFils > 0) {
    let deposit = await getOrCreateDeposit(r, `${input.idempotencyKey}:deposit`, provider.name);
    if (deposit.status === "PENDING") {
      try {
        const hold = await provider.holdDeposit({
          amountCents: deposit.amountFils,
          currency: "AED",
          paymentMethod: input.paymentMethod,
          idempotencyKey: deposit.idempotencyKey,
          metadata: meta({ depositId: deposit.id }),
        });
        deposit = (await applyHoldSnapshot(db, deposit.id, hold, now)) ?? deposit;
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        await db
          .update(deposits)
          .set({ status: "FAILED", failureReason: reason })
          .where(and(eq(deposits.id, deposit.id), eq(deposits.status, "PENDING")));
        await audit(db, { actorUserId: r.userId, action: "deposit.failed", entityType: "reservation", entityId: r.id, data: { reason } });
        return { status: "DEPOSIT_FAILED", reservationId: r.id, reason };
      }
    }
    if (deposit.status !== "HELD") {
      return { status: "DEPOSIT_FAILED", reservationId: r.id, reason: deposit.failureReason ?? deposit.status.toLowerCase() };
    }
  }

  // 3. Confirm (or discover that the hold lapsed while paying, and give the money back).
  const outcome = await tryConfirmReservation(r.id, now);
  if (outcome === "CONFIRMED") return done;
  if (outcome === "EXPIRED" || outcome === "CANCELLED" || outcome === "REFUNDED") {
    await settleReservationMoney(r.id);
    throw new ReservationError("HOLD_EXPIRED", "Your hold expired before the payment completed. Any payment has been refunded.");
  }
  return { status: "PROCESSING", reservationId: r.id };
}

// ---------------------------------------------------------------------------------------------
// Refunds and deposit releases
// ---------------------------------------------------------------------------------------------

/** Refunds `amount` of a payment: claim in DB, call provider, undo the claim if the provider fails. */
export async function refundPayment(p: PaymentRow, amountFils: number, actorUserId: string | null = null): Promise<boolean> {
  if (amountFils <= 0 || !p.providerChargeId) return false;
  const [claimed] = await db
    .update(payments)
    .set({
      refundedFils: sql`${payments.refundedFils} + ${amountFils}`,
      status: sql`case when ${payments.refundedFils} + ${amountFils} >= ${payments.amountFils} then 'REFUNDED' else 'PARTIALLY_REFUNDED' end::payment_status`,
    })
    .where(
      and(
        eq(payments.id, p.id),
        eq(payments.refundedFils, p.refundedFils),
        inArray(payments.status, ["SUCCEEDED", "PARTIALLY_REFUNDED"]),
        sql`${payments.refundedFils} + ${amountFils} <= ${payments.amountFils}`,
      ),
    )
    .returning();
  if (!claimed) return false;
  try {
    const charge = await getPayments().refundCharge(p.providerChargeId, amountFils);
    await applyChargeSnapshot(db, p.id, charge);
    await audit(db, { actorUserId, action: "payment.refunded", entityType: "payment", entityId: p.id, data: { amountFils } });
    return true;
  } catch (err) {
    await db
      .update(payments)
      .set({
        refundedFils: sql`${payments.refundedFils} - ${amountFils}`,
        status: sql`case when ${payments.refundedFils} - ${amountFils} = 0 then 'SUCCEEDED' else 'PARTIALLY_REFUNDED' end::payment_status`,
      })
      .where(eq(payments.id, p.id));
    log("error", "payment.refund_failed", { paymentId: p.id, amountFils, error: String(err) });
    throw new ReservationError("PROVIDER_ERROR", "The refund could not be processed. It will be retried automatically.");
  }
}

/** Releases a HELD deposit (claim, call provider, undo on failure). */
export async function releaseDeposit(d: DepositRow, now = new Date(), actorUserId: string | null = null): Promise<boolean> {
  if (!d.providerHoldId) return false;
  const [claimed] = await db
    .update(deposits)
    .set({ status: "RELEASED", releasedAt: now })
    .where(and(eq(deposits.id, d.id), eq(deposits.status, "HELD")))
    .returning();
  if (!claimed) return false;
  try {
    await getPayments().releaseDeposit(d.providerHoldId);
  } catch (err) {
    if (!/already released/i.test(String(err))) {
      await db.update(deposits).set({ status: "HELD", releasedAt: null }).where(eq(deposits.id, d.id));
      log("error", "deposit.release_failed", { depositId: d.id, error: String(err) });
      throw new ReservationError("PROVIDER_ERROR", "The deposit could not be released. It will be retried automatically.");
    }
  }
  await audit(db, { actorUserId, action: "deposit.released", entityType: "deposit", entityId: d.id, data: { reservationId: d.reservationId } });
  return true;
}

/** Captures `amountFils` of a HELD deposit (the rest is released by the provider). */
export async function captureDeposit(d: DepositRow, amountFils: number, now = new Date(), actorUserId: string | null = null) {
  const amount = Math.min(amountFils, d.amountFils);
  if (amount <= 0 || !d.providerHoldId) return 0;
  const [claimed] = await db
    .update(deposits)
    .set({ status: amount >= d.amountFils ? "CAPTURED" : "PARTIALLY_CAPTURED", capturedFils: amount, capturedAt: now })
    .where(and(eq(deposits.id, d.id), eq(deposits.status, "HELD")))
    .returning();
  if (!claimed) return 0;
  try {
    await getPayments().captureDeposit(d.providerHoldId, amount);
  } catch (err) {
    await db.update(deposits).set({ status: "HELD", capturedFils: 0, capturedAt: null }).where(eq(deposits.id, d.id));
    log("error", "deposit.capture_failed", { depositId: d.id, error: String(err) });
    throw new ReservationError("PROVIDER_ERROR", "The deposit could not be captured. Please try again.");
  }
  await audit(db, { actorUserId, action: "deposit.captured", entityType: "deposit", entityId: d.id, data: { amountFils: amount } });
  return amount;
}

export interface SettlementResult {
  refundedFils: number;
  depositsReleased: number;
}

/**
 * Brings the money in line with the reservation status. Idempotent; used by cancel, modify, pay and the
 * cleanup job.
 *  - EXPIRED: everything paid is refunded, deposits released.
 *  - CANCELLED / REFUNDED: everything above the cancellation fee is refunded, deposits released.
 *  - CONFIRMED: anything paid above the current total (after a cheaper date change) is refunded.
 *  - PENDING / PICKED_UP / RETURNED: nothing to do here.
 * Sets CANCELLED -> REFUNDED once a refund has been made.
 */
export async function settleReservationMoney(reservationId: string, actorUserId: string | null = null, now = new Date()): Promise<SettlementResult> {
  const [r] = await db.select().from(reservations).where(eq(reservations.id, reservationId));
  if (!r) throw new ReservationError("NOT_FOUND", "Reservation not found");
  const owed =
    r.status === "EXPIRED" ? 0 : r.status === "CANCELLED" || r.status === "REFUNDED" ? (r.cancellationFeeFils ?? 0) : r.status === "CONFIRMED" ? r.totalFils : null;
  const result: SettlementResult = { refundedFils: 0, depositsReleased: 0 };
  if (owed === null) return result;

  const paid = await db
    .select()
    .from(payments)
    .where(and(eq(payments.reservationId, r.id), inArray(payments.status, ["SUCCEEDED", "PARTIALLY_REFUNDED"])))
    .orderBy(desc(payments.createdAt));
  let due = paid.reduce((s, p) => s + p.amountFils - p.refundedFils, 0) - owed;
  for (const p of paid) {
    if (due <= 0) break;
    const amount = Math.min(due, p.amountFils - p.refundedFils);
    if (await refundPayment(p, amount, actorUserId)) {
      due -= amount;
      result.refundedFils += amount;
    }
  }

  if (r.status !== "CONFIRMED") {
    const held = await db.select().from(deposits).where(and(eq(deposits.reservationId, r.id), eq(deposits.status, "HELD")));
    for (const d of held) if (await releaseDeposit(d, now, actorUserId)) result.depositsReleased++;
  }

  await db.execute(sql`
    update reservations set
      refunded_fils = (select coalesce(sum(refunded_fils), 0) from payments where reservation_id = ${r.id}::uuid),
      status = case when status = 'CANCELLED'
        and (select coalesce(sum(refunded_fils), 0) from payments where reservation_id = ${r.id}::uuid) > 0
        then 'REFUNDED' else status end::reservation_status,
      updated_at = now()
    where id = ${r.id}::uuid`);
  return result;
}

// ---------------------------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------------------------

export interface WebhookResult {
  duplicate: boolean;
  /** Reservation affected, if the event matched one of our payments or deposits. */
  reservationId: string | null;
  reservationStatus: ConfirmOutcome | null;
}

/**
 * Processes a verified provider event exactly once per (provider, event id). Duplicate deliveries,
 * including concurrent ones, return { duplicate: true } and change nothing.
 */
export async function processPaymentEvent(providerName: string, event: PaymentEvent, now = new Date()): Promise<WebhookResult> {
  const found = await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(webhookEvents)
      .values({ provider: providerName, eventId: event.id, type: event.type, payload: event as unknown as Record<string, unknown> })
      .onConflictDoNothing()
      .returning({ id: webhookEvents.id });
    if (!inserted) return null;

    let reservationId: string | null = null;
    const metaId = (k: string) => (isUuid(event.data.metadata?.[k]) ? event.data.metadata[k] : null);
    if (event.type.startsWith("charge.")) {
      const id = metaId("paymentId");
      const [p] = await tx
        .select()
        .from(payments)
        .where(id ? eq(payments.id, id) : eq(payments.providerChargeId, event.data.id))
        .limit(1);
      if (p) {
        await applyChargeSnapshot(tx, p.id, event.data as Charge);
        reservationId = p.reservationId;
      }
    } else {
      const id = metaId("depositId");
      const [d] = await tx
        .select()
        .from(deposits)
        .where(id ? eq(deposits.id, id) : eq(deposits.providerHoldId, event.data.id))
        .limit(1);
      if (d) {
        await applyHoldSnapshot(tx, d.id, event.data as DepositHold, now);
        reservationId = d.reservationId;
      }
    }
    await tx.update(webhookEvents).set({ processedAt: now }).where(eq(webhookEvents.id, inserted.id));
    return { reservationId };
  });

  if (!found) return { duplicate: true, reservationId: null, reservationStatus: null };
  if (!found.reservationId) {
    log("warn", "webhook.unmatched", { provider: providerName, eventId: event.id, type: event.type });
    return { duplicate: false, reservationId: null, reservationStatus: null };
  }
  const status = await tryConfirmReservation(found.reservationId, now);
  if (status === "EXPIRED" || status === "CANCELLED" || status === "REFUNDED") {
    // Money that arrives for a reservation that is no longer wanted goes straight back.
    await settleReservationMoney(found.reservationId, null, now).catch((err) =>
      log("error", "webhook.settle_failed", { reservationId: found.reservationId, error: String(err) }),
    );
  }
  log("info", "webhook.processed", { eventId: event.id, type: event.type, reservationId: found.reservationId, status });
  return { duplicate: false, reservationId: found.reservationId, reservationStatus: status };
}
