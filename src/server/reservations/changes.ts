/**
 * Customer (and admin) changes to a reservation: cancel and change dates, per ./policy.ts.
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db";
import { payments, reservationExtras, reservations } from "@/server/db/schema";
import { audit, log } from "@/server/audit";
import { getPayments } from "@/server/services";
import type { Quote } from "@/server/pricing";
import { isUuid } from "@/server/data/catalog";
import { findAvailabilityConflict } from "./availability";
import { pgCode, PG_EXCLUSION_VIOLATION, ReservationError } from "./errors";
import { expireLapsedHolds, lockVehicle, unavailable, type ReservationRow } from "./holds";
import { applyChargeSnapshot, refreshVehicleStatus, refundPayment, settleReservationMoney } from "./payments";
import { canModify, cancellationTerms } from "./policy";
import { priceRequest, type ExtraSelection } from "./quote";

export interface Actor {
  userId: string;
  role: "CUSTOMER" | "ADMIN";
}

async function loadFor(reservationId: string, actor: Actor): Promise<ReservationRow> {
  if (!isUuid(reservationId)) throw new ReservationError("NOT_FOUND", "Reservation not found");
  const [r] = await db.select().from(reservations).where(eq(reservations.id, reservationId));
  if (!r || (actor.role !== "ADMIN" && r.userId !== actor.userId)) throw new ReservationError("NOT_FOUND", "Reservation not found");
  return r;
}

export interface CancelInput {
  reservationId: string;
  actor: Actor;
  reason?: string;
  /** Admin only: cancel without a fee, and also after the pick-up time (e.g. no-show handling). */
  waiveFee?: boolean;
  now?: Date;
}

export interface CancelResult {
  reservation: ReservationRow;
  feeFils: number;
  refundedFils: number;
  depositsReleased: number;
}

/**
 * Cancels per the cancellation policy, refunds what is due and releases the deposit hold.
 * Idempotent: cancelling an already cancelled reservation finishes any outstanding refund and returns.
 */
export async function cancelReservation(input: CancelInput): Promise<CancelResult> {
  const now = input.now ?? new Date();
  const r0 = await loadFor(input.reservationId, input.actor);
  const isAdmin = input.actor.role === "ADMIN";

  if (r0.status !== "CANCELLED" && r0.status !== "REFUNDED") {
    await db.transaction(async (tx) => {
      const [r] = await tx.select().from(reservations).where(eq(reservations.id, r0.id)).for("update");
      if (r.status === "CANCELLED" || r.status === "REFUNDED") return;
      const terms = cancellationTerms(r, now);
      const adminOverride = isAdmin && input.waiveFee && (r.status === "CONFIRMED" || r.status === "PENDING");
      if (!terms.allowed && !adminOverride) throw new ReservationError("POLICY_VIOLATION", terms.reason ?? "This reservation cannot be cancelled");
      const feeFils = adminOverride ? 0 : terms.feeFils;
      await tx
        .update(reservations)
        .set({
          status: "CANCELLED",
          cancelledAt: now,
          cancellationFeeFils: feeFils,
          cancellationReason: input.reason?.slice(0, 500) ?? null,
          holdExpiresAt: null,
        })
        .where(eq(reservations.id, r.id));
      await refreshVehicleStatus(tx, r.vehicleId, now);
      await audit(tx, {
        actorUserId: input.actor.userId,
        action: "reservation.cancelled",
        entityType: "reservation",
        entityId: r.id,
        data: { feeFils, tier: adminOverride ? "ADMIN_WAIVED" : terms.tier, previousStatus: r.status },
      });
    });
  }
  const settled = await settleReservationMoney(r0.id, input.actor.userId, now);
  const [r] = await db.select().from(reservations).where(eq(reservations.id, r0.id));
  log("info", "reservation.cancelled", { reservationId: r.id, refundedFils: settled.refundedFils });
  return { reservation: r, feeFils: r.cancellationFeeFils ?? 0, refundedFils: r.refundedFils, depositsReleased: settled.depositsReleased };
}

export interface ModifyInput {
  reservationId: string;
  actor: Actor;
  pickupAt: Date;
  returnAt: Date;
  /** Replaces the extras when given; keeps the current extras when omitted. */
  extras?: ExtraSelection[];
  /** Needed when the new price is higher on a CONFIRMED reservation. */
  paymentMethod?: string;
  /** One per change attempt. Retrying the same attempt does not charge twice. */
  idempotencyKey: string;
  now?: Date;
}

export interface ModifyResult {
  reservation: ReservationRow;
  quote: Quote;
  /** New total minus old total: > 0 was charged, < 0 was refunded. */
  differenceFils: number;
}

/** Prices a date change without making it (for the "change dates" page). */
export async function previewModification(input: Omit<ModifyInput, "idempotencyKey" | "paymentMethod">) {
  const now = input.now ?? new Date();
  const r = await loadFor(input.reservationId, input.actor);
  const allowed = canModify(r, now);
  const extras = input.extras ?? (await currentExtras(r.id));
  const priced = await priceRequest(
    db,
    { vehicleId: r.vehicleId, pickupBranchId: r.pickupBranchId, returnBranchId: r.returnBranchId, pickupAt: input.pickupAt, returnAt: input.returnAt, extras },
    now,
  );
  const conflict = await findAvailabilityConflict(db, {
    vehicleId: r.vehicleId,
    pickupBranchId: r.pickupBranchId,
    returnBranchId: r.returnBranchId,
    from: input.pickupAt,
    to: input.returnAt,
    now,
    excludeReservationId: r.id,
  });
  return {
    allowed: allowed.allowed && !conflict,
    reason: allowed.reason ?? (conflict ? "The vehicle is not available for the new dates" : undefined),
    quote: priced.quote,
    differenceFils: priced.quote.totalFils - r.totalFils,
  };
}

async function currentExtras(reservationId: string): Promise<ExtraSelection[]> {
  return db
    .select({ extraId: reservationExtras.extraId, quantity: reservationExtras.quantity })
    .from(reservationExtras)
    .where(eq(reservationExtras.reservationId, reservationId));
}

/**
 * Changes the dates (and optionally extras) of a PENDING or CONFIRMED reservation on the same vehicle
 * and branches. CONFIRMED: allowed up to 24 h before the current pick-up; a higher price is charged first,
 * a lower price is refunded after the change. The exclusion constraint guards the new period.
 */
export async function modifyReservation(input: ModifyInput): Promise<ModifyResult> {
  const now = input.now ?? new Date();
  if (typeof input.idempotencyKey !== "string" || input.idempotencyKey.length < 8 || input.idempotencyKey.length > 180) {
    throw new ReservationError("VALIDATION", "A request key of 8-180 characters is required");
  }
  const r = await loadFor(input.reservationId, input.actor);
  const extras = input.extras ?? (await currentExtras(r.id));

  // Replay of an attempt that already went through.
  if (r.pickupAt.getTime() === input.pickupAt.getTime() && r.returnAt.getTime() === input.returnAt.getTime() && input.extras === undefined) {
    return { reservation: r, quote: r.priceBreakdown as Quote, differenceFils: 0 };
  }
  const allowed = canModify(r, now);
  if (!allowed.allowed) throw new ReservationError("POLICY_VIOLATION", allowed.reason!);
  if (r.status === "PENDING") {
    const [paid] = await db
      .select({ id: payments.id })
      .from(payments)
      .where(and(eq(payments.reservationId, r.id), eq(payments.status, "SUCCEEDED")))
      .limit(1);
    if (paid) throw new ReservationError("INVALID_STATE", "Finish paying for this reservation before changing it");
  }

  const request = {
    vehicleId: r.vehicleId,
    pickupBranchId: r.pickupBranchId,
    returnBranchId: r.returnBranchId,
    pickupAt: input.pickupAt,
    returnAt: input.returnAt,
    extras,
  };
  const preview = await priceRequest(db, request, now);
  const difference = preview.quote.totalFils - r.totalFils;
  const conflict = await findAvailabilityConflict(db, { ...request, from: input.pickupAt, to: input.returnAt, now, excludeReservationId: r.id });
  if (conflict) throw unavailable({ conflict });

  // Charge the difference first (CONFIRMED and more expensive).
  let extraPayment: typeof payments.$inferSelect | null = null;
  if (r.status === "CONFIRMED" && difference > 0) {
    if (!input.paymentMethod) {
      throw new ReservationError("PAYMENT_REQUIRED", "The new dates cost more; a payment is required", { differenceFils: difference });
    }
    const provider = getPayments();
    const key = `${input.idempotencyKey}:modify`;
    await db
      .insert(payments)
      .values({ reservationId: r.id, kind: "MODIFICATION", amountFils: difference, provider: provider.name, idempotencyKey: key })
      .onConflictDoNothing({ target: payments.idempotencyKey });
    [extraPayment] = await db.select().from(payments).where(eq(payments.idempotencyKey, key));
    if (extraPayment.reservationId !== r.id || extraPayment.amountFils !== difference) {
      throw new ReservationError("IDEMPOTENCY_CONFLICT", "This request key was already used for a different change");
    }
    if (extraPayment.status === "PENDING") {
      const charge = await provider
        .createCharge({
          amountCents: difference,
          currency: "AED",
          paymentMethod: input.paymentMethod,
          idempotencyKey: key,
          metadata: { reservationId: r.id, reference: r.reference, paymentId: extraPayment.id },
        })
        .catch((err) => {
          log("error", "payment.charge_error", { reservationId: r.id, error: String(err) });
          throw new ReservationError("PROVIDER_ERROR", "The payment could not be processed. Please try again.");
        });
      extraPayment = (await applyChargeSnapshot(db, extraPayment.id, charge)) ?? extraPayment;
    }
    if (extraPayment.status !== "SUCCEEDED") {
      throw new ReservationError("PAYMENT_FAILED", "The payment for the date change was declined", { reason: extraPayment.failureReason });
    }
  }

  let updated: ReservationRow;
  let quote: Quote;
  try {
    ({ updated, quote } = await db.transaction(async (tx) => {
      await lockVehicle(tx, r.vehicleId);
      const [cur] = await tx.select().from(reservations).where(eq(reservations.id, r.id)).for("update");
      if (cur.status !== r.status || cur.totalFils !== r.totalFils) {
        throw new ReservationError("INVALID_STATE", "The reservation changed in the meantime. Please review it again.");
      }
      await expireLapsedHolds(tx, r.vehicleId, now);
      const conflictNow = await findAvailabilityConflict(tx, { ...request, from: input.pickupAt, to: input.returnAt, now, excludeReservationId: r.id });
      if (conflictNow) throw unavailable({ conflict: conflictNow });
      const priced = await priceRequest(tx, request, now);
      const q = priced.quote;
      const [row] = await tx
        .update(reservations)
        .set({
          pickupAt: input.pickupAt,
          returnAt: input.returnAt,
          rentalDays: q.days,
          dailyRateFils: q.baseDailyRateFils,
          rentalFils: q.rentalFils,
          discountFils: q.discountFils,
          extrasFils: q.extrasFils,
          oneWayFeeFils: q.oneWayFeeFils,
          subtotalFils: q.subtotalFils,
          vatBps: q.vatBps,
          vatFils: q.vatFils,
          totalFils: q.totalFils,
          // The deposit agreed at payment stays; a PENDING reservation takes the current one.
          depositFils: r.status === "PENDING" ? q.depositFils : r.depositFils,
          priceBreakdown: q,
        })
        .where(eq(reservations.id, r.id))
        .returning();
      await tx.delete(reservationExtras).where(eq(reservationExtras.reservationId, r.id));
      if (q.extras.length) {
        await tx.insert(reservationExtras).values(
          q.extras.map((e) => ({
            reservationId: r.id,
            extraId: e.extraId,
            quantity: e.quantity,
            pricing: e.pricing,
            unitPriceFils: e.unitPriceFils,
            totalFils: e.totalFils,
          })),
        );
      }
      await refreshVehicleStatus(tx, r.vehicleId, now);
      await audit(tx, {
        actorUserId: input.actor.userId,
        action: "reservation.modified",
        entityType: "reservation",
        entityId: r.id,
        data: {
          from: { pickupAt: r.pickupAt, returnAt: r.returnAt, totalFils: r.totalFils },
          to: { pickupAt: input.pickupAt, returnAt: input.returnAt, totalFils: q.totalFils },
        },
      });
      return { updated: row, quote: q };
    }));
  } catch (err) {
    // Give back the extra charge if the change did not happen.
    if (extraPayment?.status === "SUCCEEDED") await refundPayment(extraPayment, extraPayment.amountFils - extraPayment.refundedFils, input.actor.userId).catch(() => {});
    if (pgCode(err) === PG_EXCLUSION_VIOLATION || pgCode(err) === "40P01") throw unavailable();
    throw err;
  }

  if (updated.status === "CONFIRMED" && quote.totalFils < r.totalFils) await settleReservationMoney(r.id, input.actor.userId, now);
  const [fresh] = await db.select().from(reservations).where(eq(reservations.id, r.id));
  return { reservation: fresh, quote, differenceFils: quote.totalFils - r.totalFils };
}
