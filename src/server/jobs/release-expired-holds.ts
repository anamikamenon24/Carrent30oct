import { and, eq, inArray, isNotNull, lte, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { auditLogs, payments, reservations } from "@/server/db/schema";
import { log } from "@/server/audit";
import { getPayments } from "@/server/services";
import { applyChargeSnapshot, refreshVehicleStatus, settleReservationMoney } from "@/server/reservations/payments";

export interface ReleaseExpiredHoldsResult {
  /** PENDING holds that this run marked EXPIRED. */
  released: number;
  /** Money returned for expired/cancelled reservations (fils). */
  refundedFils: number;
  depositsReleased: number;
  chargesCancelled: number;
  errors: number;
}

/**
 * Releases rental holds whose time limit has passed, freeing the vehicle, then settles money for
 * reservations that are no longer going ahead (refund charges, release deposit holds, cancel pending
 * charges). Idempotent and safe to run concurrently: each hold is expired by exactly one run (the
 * UPDATE ... WHERE status = 'PENDING' re-checks the row after any lock wait), and refunds/releases are
 * claimed in the database before calling the provider.
 */
export async function releaseExpiredHolds(now: Date = new Date()): Promise<ReleaseExpiredHoldsResult> {
  const result: ReleaseExpiredHoldsResult = { released: 0, refundedFils: 0, depositsReleased: 0, chargesCancelled: 0, errors: 0 };

  // 1. Expire lapsed holds. Their vehicle_occupancy rows are removed by the trigger, freeing the vehicle.
  const expired = await db.transaction(async (tx) => {
    const rows = await tx
      .update(reservations)
      .set({ status: "EXPIRED", expiredAt: now })
      .where(and(eq(reservations.status, "PENDING"), lte(reservations.holdExpiresAt, now)))
      .returning({ id: reservations.id, vehicleId: reservations.vehicleId });
    if (rows.length) {
      await tx.insert(auditLogs).values(
        rows.map((r) => ({ action: "reservation.expired", entityType: "reservation", entityId: r.id, data: { job: "release-expired-holds" } })),
      );
      for (const vehicleId of new Set(rows.map((r) => r.vehicleId))) await refreshVehicleStatus(tx, vehicleId, now);
    }
    return rows;
  });
  result.released = expired.length;

  // 2. Settle money for reservations that ended without a rental (this run's or earlier ones).
  const { rows: toSettle } = await db.execute<{ id: string }>(sql`
    select r.id from reservations r
    where r.status in ('EXPIRED', 'CANCELLED', 'REFUNDED')
      and (exists (select 1 from deposits d where d.reservation_id = r.id and d.status = 'HELD')
        or (select coalesce(sum(p.amount_fils - p.refunded_fils), 0) from payments p
            where p.reservation_id = r.id and p.status in ('SUCCEEDED', 'PARTIALLY_REFUNDED'))
           > case when r.status = 'EXPIRED' then 0 else coalesce(r.cancellation_fee_fils, 0) end)
    limit 500`);
  for (const { id } of toSettle) {
    try {
      const s = await settleReservationMoney(id, null, now);
      result.refundedFils += s.refundedFils;
      result.depositsReleased += s.depositsReleased;
    } catch (err) {
      result.errors++;
      log("error", "job.settle_failed", { reservationId: id, error: String(err) });
    }
  }

  // 3. Cancel charges still pending at the provider for reservations that will not go ahead.
  const pending = await db
    .select({ payment: payments })
    .from(payments)
    .innerJoin(reservations, eq(reservations.id, payments.reservationId))
    .where(
      and(
        eq(payments.status, "PENDING"),
        isNotNull(payments.providerChargeId),
        inArray(reservations.status, ["EXPIRED", "CANCELLED", "REFUNDED"]),
      ),
    )
    .limit(500);
  for (const { payment } of pending) {
    try {
      const charge = await getPayments().cancelCharge(payment.providerChargeId!);
      await applyChargeSnapshot(db, payment.id, charge);
      result.chargesCancelled++;
    } catch (err) {
      result.errors++;
      log("warn", "job.cancel_charge_failed", { paymentId: payment.id, error: String(err) });
    }
  }

  if (result.released || result.refundedFils || result.depositsReleased || result.chargesCancelled || result.errors) {
    log("info", "job.release_expired_holds", { ...result });
  }
  return result;
}
