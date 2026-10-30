/**
 * Step 1-7 and 9-10 of the reservation transaction: create a PENDING reservation that holds the vehicle.
 */
import { randomInt } from "node:crypto";
import { and, eq, lte } from "drizzle-orm";
import { getEnv } from "@/server/config";
import { db, type DbOrTx, type Tx } from "@/server/db";
import { reservationExtras, reservations, vehicles } from "@/server/db/schema";
import { audit, log } from "@/server/audit";
import type { Quote } from "@/server/pricing";
import { isUuid } from "@/server/data/catalog";
import { findAvailabilityConflict } from "./availability";
import { pgCode, PG_EXCLUSION_VIOLATION, PG_UNIQUE_VIOLATION, ReservationError } from "./errors";
import { priceRequest, type ExtraSelection, type QuoteRequest } from "./quote";

export type ReservationRow = typeof reservations.$inferSelect;

export interface CreateHoldInput extends QuoteRequest {
  userId: string;
  /** Client-generated (e.g. crypto.randomUUID() when the checkout page loads). Retries reuse it. */
  idempotencyKey: string;
  now?: Date;
}

export interface CreateHoldResult {
  reservation: ReservationRow;
  quote: Quote;
  /** True when this idempotency key had already created the reservation (nothing new was written). */
  replayed: boolean;
}

const REF_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function newReference(prefix = "DE") {
  let s = "";
  for (let i = 0; i < 8; i++) s += REF_ALPHABET[randomInt(REF_ALPHABET.length)];
  return `${prefix}-${s}`;
}

/** Concurrency losers can surface as an exclusion violation, a deadlock or a serialisation failure. */
const CONFLICT_CODES = new Set([PG_EXCLUSION_VIOLATION, "40P01", "40001"]);

export function unavailable(details?: Record<string, unknown>) {
  return new ReservationError("VEHICLE_UNAVAILABLE", "Sorry, this vehicle is no longer available for the selected period.", details);
}

/** Marks lapsed holds on one vehicle as EXPIRED (frees their occupancy). Money is settled by the cleanup job. */
export async function expireLapsedHolds(tx: DbOrTx, vehicleId: string, now: Date) {
  const rows = await tx
    .update(reservations)
    .set({ status: "EXPIRED", expiredAt: now })
    .where(and(eq(reservations.vehicleId, vehicleId), eq(reservations.status, "PENDING"), lte(reservations.holdExpiresAt, now)))
    .returning({ id: reservations.id });
  for (const r of rows) await audit(tx, { action: "reservation.expired", entityType: "reservation", entityId: r.id, data: { lazy: true } });
  return rows.length;
}

/** Locks the vehicle row (step 2) so concurrent bookings of the same vehicle run one after another. */
export async function lockVehicle(tx: Tx, vehicleId: string) {
  const [v] = await tx.select().from(vehicles).where(eq(vehicles.id, vehicleId)).for("update");
  if (!v) throw new ReservationError("NOT_FOUND", "Vehicle not found");
  return v;
}

function sameRequest(r: ReservationRow, input: CreateHoldInput, extras: ExtraSelection[], existingExtras: ExtraSelection[]) {
  return (
    r.vehicleId === input.vehicleId &&
    r.pickupBranchId === input.pickupBranchId &&
    r.returnBranchId === input.returnBranchId &&
    r.pickupAt.getTime() === input.pickupAt.getTime() &&
    r.returnAt.getTime() === input.returnAt.getTime() &&
    JSON.stringify(extras) === JSON.stringify(existingExtras)
  );
}

async function findByKey(conn: DbOrTx, input: CreateHoldInput) {
  const [existing] = await conn
    .select()
    .from(reservations)
    .where(and(eq(reservations.userId, input.userId), eq(reservations.idempotencyKey, input.idempotencyKey)))
    .limit(1);
  if (!existing) return null;
  const ex = await conn
    .select({ extraId: reservationExtras.extraId, quantity: reservationExtras.quantity })
    .from(reservationExtras)
    .where(eq(reservationExtras.reservationId, existing.id));
  const normalised = [...(input.extras ?? [])]
    .filter((e) => e.quantity > 0)
    .map((e) => ({ extraId: e.extraId, quantity: e.quantity }))
    .sort((a, b) => a.extraId.localeCompare(b.extraId));
  const stored = ex.sort((a, b) => a.extraId.localeCompare(b.extraId));
  if (!sameRequest(existing, input, normalised, stored)) {
    throw new ReservationError("IDEMPOTENCY_CONFLICT", "This request key was already used for a different reservation");
  }
  return { reservation: existing, quote: existing.priceBreakdown as Quote, replayed: true } satisfies CreateHoldResult;
}

/**
 * Creates a PENDING reservation that holds the vehicle for RESERVATION_HOLD_MINUTES (default 15).
 *
 * 1. begin transaction  2. lock the vehicle row  3. check no overlapping reservation / maintenance
 * 4. set the hold expiry  5. price on the server  6. insert the PENDING reservation  7. commit.
 * 9. Repeating a call with the same (userId, idempotencyKey) returns the same reservation.
 * 10. Throws ReservationError("VEHICLE_UNAVAILABLE") if the vehicle is taken, including when a concurrent
 *     request wins the race (the exclusion constraint is the final guard).
 */
export async function createReservationHold(input: CreateHoldInput): Promise<CreateHoldResult> {
  const now = input.now ?? new Date();
  if (typeof input.idempotencyKey !== "string" || input.idempotencyKey.length < 8 || input.idempotencyKey.length > 200) {
    throw new ReservationError("VALIDATION", "A request key of 8-200 characters is required");
  }
  if (!isUuid(input.vehicleId)) throw new ReservationError("NOT_FOUND", "Vehicle not found");
  if (!isUuid(input.pickupBranchId) || !isUuid(input.returnBranchId)) throw new ReservationError("NOT_FOUND", "Branch not found");
  if (!isUuid(input.userId)) throw new ReservationError("FORBIDDEN", "Sign in to reserve a vehicle");
  const replay = await findByKey(db, input);
  if (replay) return replay;

  const holdMinutes = getEnv().RESERVATION_HOLD_MINUTES;
  try {
    return await db.transaction(async (tx) => {
      const vehicle = await lockVehicle(tx, input.vehicleId);
      // A concurrent retry with the same key may have committed while we waited for the lock.
      const replayed = await findByKey(tx, input);
      if (replayed) return replayed;
      if (vehicle.status === "RETIRED" || vehicle.status === "MAINTENANCE") {
        throw new ReservationError("VEHICLE_NOT_RENTABLE", "This vehicle is not available for rental");
      }
      const priced = await priceRequest(tx, input, now);

      await expireLapsedHolds(tx, vehicle.id, now);
      const conflict = await findAvailabilityConflict(tx, {
        vehicleId: vehicle.id,
        pickupBranchId: input.pickupBranchId,
        returnBranchId: input.returnBranchId,
        from: input.pickupAt,
        to: input.returnAt,
        now,
      });
      if (conflict) throw unavailable({ conflict });

      const q = priced.quote;
      const [reservation] = await tx
        .insert(reservations)
        .values({
          reference: newReference(),
          userId: input.userId,
          vehicleId: vehicle.id,
          pickupBranchId: input.pickupBranchId,
          returnBranchId: input.returnBranchId,
          pickupAt: input.pickupAt,
          returnAt: input.returnAt,
          status: "PENDING",
          holdExpiresAt: new Date(now.getTime() + holdMinutes * 60_000),
          idempotencyKey: input.idempotencyKey,
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
          depositFils: q.depositFils,
          priceBreakdown: q,
        })
        .returning();
      if (q.extras.length) {
        await tx.insert(reservationExtras).values(
          q.extras.map((e) => ({
            reservationId: reservation.id,
            extraId: e.extraId,
            quantity: e.quantity,
            pricing: e.pricing,
            unitPriceFils: e.unitPriceFils,
            totalFils: e.totalFils,
          })),
        );
      }
      await audit(tx, {
        actorUserId: input.userId,
        action: "reservation.hold_created",
        entityType: "reservation",
        entityId: reservation.id,
        data: { reference: reservation.reference, totalFils: q.totalFils, holdExpiresAt: reservation.holdExpiresAt },
      });
      log("info", "reservation.hold_created", { reservationId: reservation.id, vehicleId: vehicle.id });
      return { reservation, quote: q, replayed: false };
    });
  } catch (err) {
    const code = pgCode(err);
    if (code && CONFLICT_CODES.has(code)) throw unavailable();
    if (code === PG_UNIQUE_VIOLATION) {
      // The same idempotency key raced with itself: return whatever the winner created.
      const again = await findByKey(db, input);
      if (again) return again;
    }
    throw err;
  }
}

/** Current hold length in minutes (for UI countdowns). */
export const holdMinutes = () => getEnv().RESERVATION_HOLD_MINUTES;

