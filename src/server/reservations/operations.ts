/**
 * Counter operations (admin/staff): check-out (pick-up), check-in (return) and damage reports.
 * Callers must check the admin role; these functions take the staff user's id for the audit trail.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { damageReports, deposits, rentalAgreements, reservations, vehicles } from "@/server/db/schema";
import { audit, log } from "@/server/audit";
import { fuelCharge, lateReturnCharge, vatOn } from "@/server/pricing";
import { isUuid } from "@/server/data/catalog";
import { ReservationError } from "./errors";
import type { ReservationRow } from "./holds";
import { captureDeposit, refreshVehicleStatus, releaseDeposit } from "./payments";
import { POLICY } from "./policy";

export type RentalAgreement = typeof rentalAgreements.$inferSelect;
export type DamageReport = typeof damageReports.$inferSelect;

function assertReading(mileageKm: number, fuelEighths: number) {
  if (!Number.isInteger(mileageKm) || mileageKm < 0 || mileageKm > 2_000_000) throw new ReservationError("VALIDATION", "Enter the odometer reading in whole km");
  if (!Number.isInteger(fuelEighths) || fuelEighths < 0 || fuelEighths > 8) throw new ReservationError("VALIDATION", "Fuel level must be 0-8 eighths");
}

export interface CheckOutInput {
  reservationId: string;
  staffUserId: string;
  mileageKm: number;
  /** 0 (empty) to 8 (full). */
  fuelEighths: number;
  notes?: string;
  now?: Date;
}

/** Hands the car over: CONFIRMED -> PICKED_UP, creates the rental agreement, vehicle -> ON_RENT. */
export async function checkOut(input: CheckOutInput): Promise<{ reservation: ReservationRow; agreement: RentalAgreement }> {
  const now = input.now ?? new Date();
  assertReading(input.mileageKm, input.fuelEighths);
  if (!isUuid(input.reservationId)) throw new ReservationError("NOT_FOUND", "Reservation not found");
  return db.transaction(async (tx) => {
    const [r] = await tx.select().from(reservations).where(eq(reservations.id, input.reservationId)).for("update");
    if (!r) throw new ReservationError("NOT_FOUND", "Reservation not found");
    if (r.status !== "CONFIRMED") throw new ReservationError("INVALID_STATE", `Only confirmed reservations can be checked out (this one is ${r.status.toLowerCase()})`);
    if (now.getTime() < r.pickupAt.getTime() - POLICY.earlyCheckoutMinutes * 60_000) {
      throw new ReservationError("POLICY_VIOLATION", `Check-out opens ${POLICY.earlyCheckoutMinutes / 60} hours before the pick-up time`);
    }
    if (now >= r.returnAt) throw new ReservationError("POLICY_VIOLATION", "The rental period has already ended");
    const [v] = await tx.select().from(vehicles).where(eq(vehicles.id, r.vehicleId)).for("update");
    if (v.status === "MAINTENANCE" || v.status === "RETIRED") throw new ReservationError("VEHICLE_NOT_RENTABLE", "This vehicle is out of service");
    if (v.status === "ON_RENT") throw new ReservationError("INVALID_STATE", "The vehicle has not been returned by the previous renter yet");
    if (v.branchId !== r.pickupBranchId) throw new ReservationError("INVALID_STATE", "The vehicle is not at the pick-up branch");
    if (input.mileageKm < v.mileageKm) throw new ReservationError("VALIDATION", `The odometer cannot be below the last recorded ${v.mileageKm} km`);

    const [agreement] = await tx
      .insert(rentalAgreements)
      .values({
        reservationId: r.id,
        agreementNumber: r.reference.replace(/^DE-/, "RA-"),
        checkedOutBy: input.staffUserId,
        checkedOutAt: now,
        pickupMileageKm: input.mileageKm,
        pickupFuelEighths: input.fuelEighths,
        pickupNotes: input.notes?.slice(0, 2000) ?? null,
      })
      .returning();
    const [updated] = await tx.update(reservations).set({ status: "PICKED_UP" }).where(eq(reservations.id, r.id)).returning();
    await tx.update(vehicles).set({ mileageKm: input.mileageKm, status: "ON_RENT" }).where(eq(vehicles.id, v.id));
    await audit(tx, {
      actorUserId: input.staffUserId,
      action: "reservation.checked_out",
      entityType: "reservation",
      entityId: r.id,
      data: { mileageKm: input.mileageKm, fuelEighths: input.fuelEighths },
    });
    return { reservation: updated, agreement };
  });
}

export interface CheckInInput {
  reservationId: string;
  staffUserId: string;
  mileageKm: number;
  fuelEighths: number;
  /** Where the car was returned; defaults to the booked return branch. */
  returnBranchId?: string;
  notes?: string;
  now?: Date;
}

export interface CheckInResult {
  reservation: ReservationRow;
  agreement: RentalAgreement;
  charges: {
    lateMinutes: number;
    lateFeeFils: number;
    fuelChargeFils: number;
    damageChargeFils: number;
    vatFils: number;
    totalFils: number;
    /** Taken from the deposit hold. */
    capturedFromDepositFils: number;
    /** Not covered by the deposit; to be collected at the counter. */
    outstandingFils: number;
  };
}

/**
 * Takes the car back: PICKED_UP -> RETURNED. Charges late return, missing fuel and damage reports with a
 * charge (all plus VAT) against the deposit hold; releases the rest of the deposit.
 * Record return damage with createDamageReport (stage RETURN, chargeFils) before calling this.
 */
export async function checkIn(input: CheckInInput): Promise<CheckInResult> {
  const now = input.now ?? new Date();
  assertReading(input.mileageKm, input.fuelEighths);
  if (!isUuid(input.reservationId)) throw new ReservationError("NOT_FOUND", "Reservation not found");
  if (input.returnBranchId && !isUuid(input.returnBranchId)) throw new ReservationError("NOT_FOUND", "Branch not found");

  const result = await db.transaction(async (tx) => {
    const [r] = await tx.select().from(reservations).where(eq(reservations.id, input.reservationId)).for("update");
    if (!r) throw new ReservationError("NOT_FOUND", "Reservation not found");
    if (r.status !== "PICKED_UP") throw new ReservationError("INVALID_STATE", `Only picked-up rentals can be checked in (this one is ${r.status.toLowerCase()})`);
    const [a] = await tx.select().from(rentalAgreements).where(eq(rentalAgreements.reservationId, r.id)).for("update");
    if (input.mileageKm < a.pickupMileageKm) throw new ReservationError("VALIDATION", `The odometer cannot be below the pick-up reading of ${a.pickupMileageKm} km`);

    const late = lateReturnCharge(r.dailyRateFils, r.returnAt, now);
    const fuel = fuelCharge(a.pickupFuelEighths, input.fuelEighths);
    const damage = await tx
      .select()
      .from(damageReports)
      .where(and(eq(damageReports.reservationId, r.id), inArray(damageReports.status, ["OPEN", "CHARGED"]), sql`${damageReports.chargeFils} > 0`));
    const damageFils = damage.reduce((s, d) => s + d.chargeFils, 0);
    const net = late.feeFils + fuel + damageFils;
    const vat = vatOn(net, r.vatBps);
    const returnBranchId = input.returnBranchId ?? r.returnBranchId;

    const [agreement] = await tx
      .update(rentalAgreements)
      .set({
        checkedInBy: input.staffUserId,
        returnedAt: now,
        returnBranchId,
        returnMileageKm: input.mileageKm,
        returnFuelEighths: input.fuelEighths,
        returnNotes: input.notes?.slice(0, 2000) ?? null,
        lateMinutes: late.lateMinutes,
        lateFeeFils: late.feeFils,
        fuelChargeFils: fuel,
        damageChargeFils: damageFils,
        returnVatFils: vat,
        returnChargesFils: net + vat,
        outstandingFils: net + vat,
      })
      .where(eq(rentalAgreements.id, a.id))
      .returning();
    if (damage.length) {
      await tx.update(damageReports).set({ status: "CHARGED", rentalAgreementId: a.id }).where(inArray(damageReports.id, damage.map((d) => d.id)));
    }
    const [updated] = await tx.update(reservations).set({ status: "RETURNED" }).where(eq(reservations.id, r.id)).returning();
    await tx
      .update(vehicles)
      .set({ mileageKm: input.mileageKm, branchId: returnBranchId, status: "AVAILABLE" })
      .where(and(eq(vehicles.id, r.vehicleId), eq(vehicles.status, "ON_RENT")));
    await refreshVehicleStatus(tx, r.vehicleId, now);
    await audit(tx, {
      actorUserId: input.staffUserId,
      action: "reservation.checked_in",
      entityType: "reservation",
      entityId: r.id,
      data: { mileageKm: input.mileageKm, fuelEighths: input.fuelEighths, lateMinutes: late.lateMinutes, chargesFils: net + vat },
    });
    return { reservation: updated, agreement, late, fuel, damageFils, vat, total: net + vat };
  });

  // Money moves after the commit (no transaction is held during provider calls).
  const [held] = await db.select().from(deposits).where(and(eq(deposits.reservationId, input.reservationId), eq(deposits.status, "HELD")));
  let captured = 0;
  if (held) {
    if (result.total > 0) captured = await captureDeposit(held, result.total, now, input.staffUserId);
    else await releaseDeposit(held, now, input.staffUserId);
  }
  const outstanding = Math.max(0, result.total - captured);
  const [agreement] = await db
    .update(rentalAgreements)
    .set({ outstandingFils: outstanding })
    .where(eq(rentalAgreements.id, result.agreement.id))
    .returning();
  log("info", "reservation.checked_in", { reservationId: input.reservationId, chargesFils: result.total, captured, outstanding });
  return {
    reservation: result.reservation,
    agreement,
    charges: {
      lateMinutes: result.late.lateMinutes,
      lateFeeFils: result.late.feeFils,
      fuelChargeFils: result.fuel,
      damageChargeFils: result.damageFils,
      vatFils: result.vat,
      totalFils: result.total,
      capturedFromDepositFils: captured,
      outstandingFils: outstanding,
    },
  };
}

export interface DamageReportInput {
  vehicleId: string;
  reservationId?: string | null;
  staffUserId: string;
  stage: "PICKUP" | "RETURN" | "OTHER";
  severity: "MINOR" | "MODERATE" | "MAJOR";
  location?: string;
  description: string;
  /** Private storage keys from storeUpload(). */
  photoKeys?: string[];
  estimatedCostFils?: number | null;
  /** Amount (before VAT) to charge the renter at check-in. Only for stage RETURN with a reservation. */
  chargeFils?: number;
}

export async function createDamageReport(input: DamageReportInput): Promise<DamageReport> {
  if (!isUuid(input.vehicleId)) throw new ReservationError("NOT_FOUND", "Vehicle not found");
  if (!input.description?.trim()) throw new ReservationError("VALIDATION", "Describe the damage");
  const charge = input.chargeFils ?? 0;
  if (!Number.isInteger(charge) || charge < 0) throw new ReservationError("VALIDATION", "The charge must be a whole, non-negative amount");
  if (input.estimatedCostFils != null && (!Number.isInteger(input.estimatedCostFils) || input.estimatedCostFils < 0)) {
    throw new ReservationError("VALIDATION", "The estimate must be a whole, non-negative amount");
  }
  if (charge > 0 && !input.reservationId) throw new ReservationError("VALIDATION", "Only damage linked to a rental can be charged");
  if ((input.photoKeys?.length ?? 0) > 12) throw new ReservationError("VALIDATION", "At most 12 photos per report");
  return db.transaction(async (tx) => {
    let agreementId: string | null = null;
    if (input.reservationId) {
      if (!isUuid(input.reservationId)) throw new ReservationError("NOT_FOUND", "Reservation not found");
      const [r] = await tx.select().from(reservations).where(eq(reservations.id, input.reservationId));
      if (!r || r.vehicleId !== input.vehicleId) throw new ReservationError("VALIDATION", "That reservation is not for this vehicle");
      if (charge > 0 && r.status !== "PICKED_UP") throw new ReservationError("INVALID_STATE", "Charges can only be added before the car is checked in");
      const [a] = await tx.select({ id: rentalAgreements.id }).from(rentalAgreements).where(eq(rentalAgreements.reservationId, r.id));
      agreementId = a?.id ?? null;
    }
    const [row] = await tx
      .insert(damageReports)
      .values({
        vehicleId: input.vehicleId,
        reservationId: input.reservationId ?? null,
        rentalAgreementId: agreementId,
        reportedBy: input.staffUserId,
        stage: input.stage,
        severity: input.severity,
        location: input.location?.slice(0, 200) ?? null,
        description: input.description.trim().slice(0, 4000),
        photoKeys: input.photoKeys ?? [],
        estimatedCostFils: input.estimatedCostFils ?? null,
        chargeFils: charge,
      })
      .returning();
    await audit(tx, { actorUserId: input.staffUserId, action: "damage_report.created", entityType: "damage_report", entityId: row.id, data: { severity: row.severity, chargeFils: charge } });
    return row;
  });
}

export async function updateDamageReportStatus(id: string, status: DamageReport["status"], staffUserId: string) {
  if (!isUuid(id)) throw new ReservationError("NOT_FOUND", "Damage report not found");
  const [row] = await db.update(damageReports).set({ status }).where(eq(damageReports.id, id)).returning();
  if (!row) throw new ReservationError("NOT_FOUND", "Damage report not found");
  await audit(db, { actorUserId: staffUserId, action: "damage_report.status", entityType: "damage_report", entityId: id, data: { status } });
  return row;
}

export async function listDamageReports(f: { vehicleId?: string; reservationId?: string; status?: DamageReport["status"][] } = {}) {
  return db
    .select({
      report: damageReports,
      vehicle: { id: vehicles.id, make: vehicles.make, model: vehicles.model, plateNumber: vehicles.plateNumber },
      reservationReference: reservations.reference,
    })
    .from(damageReports)
    .innerJoin(vehicles, eq(vehicles.id, damageReports.vehicleId))
    .leftJoin(reservations, eq(reservations.id, damageReports.reservationId))
    .where(
      and(
        f.vehicleId && isUuid(f.vehicleId) ? eq(damageReports.vehicleId, f.vehicleId) : undefined,
        f.reservationId && isUuid(f.reservationId) ? eq(damageReports.reservationId, f.reservationId) : undefined,
        f.status?.length ? inArray(damageReports.status, f.status) : undefined,
      ),
    )
    .orderBy(desc(damageReports.createdAt))
    .limit(500);
}

export async function getDamageReport(id: string) {
  if (!isUuid(id)) return null;
  const [row] = await db.select().from(damageReports).where(eq(damageReports.id, id));
  return row ?? null;
}
