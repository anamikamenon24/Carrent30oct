/**
 * Admin writes: branches, categories, vehicles, features, pricing rules, extras, maintenance blocks.
 * Callers must check the ADMIN role first (requireAdmin()); every function takes the admin's user id for
 * the audit log. Inputs are validated here with zod; failures throw ReservationError("VALIDATION") with
 * `details.fields`. Unique-constraint clashes (plate, VIN, codes) are reported the same way.
 */
import { and, asc, eq, gt, lt } from "drizzle-orm";
import { z } from "zod";
import { db, type DbOrTx } from "@/server/db";
import {
  branches,
  extras,
  maintenanceBlocks,
  pricingRules,
  vehicleCategories,
  vehicleFeatureMap,
  vehicleFeatures,
  vehicles,
} from "@/server/db/schema";
import { audit } from "@/server/audit";
import { pgCode, PG_EXCLUSION_VIOLATION, PG_UNIQUE_VIOLATION, ReservationError } from "@/server/reservations/errors";
import { refreshVehicleStatus } from "@/server/reservations/payments";
import { isUuid } from "./catalog";

const fils = z.number().int().min(0).max(100_000_000);
const posFils = z.number().int().min(1).max(100_000_000);
const uuid = z.uuid();
const optText = (max = 500) => z.string().trim().max(max).nullish();
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:00)?$/, "Use HH:MM");
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

function parse<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const r = schema.safeParse(input);
  if (!r.success) {
    throw new ReservationError("VALIDATION", r.error.issues[0]?.message ?? "Invalid input", {
      fields: z.flattenError(r.error).fieldErrors,
    });
  }
  return r.data;
}

function friendly(err: unknown): never {
  const code = pgCode(err);
  const constraint = (err as { cause?: { constraint?: string }; constraint?: string }).cause?.constraint ?? (err as { constraint?: string }).constraint ?? "";
  if (code === PG_UNIQUE_VIOLATION) {
    const what = /plate/.test(constraint) ? "plate number" : /vin/.test(constraint) ? "VIN" : /code/.test(constraint) ? "code" : "value";
    throw new ReservationError("VALIDATION", `That ${what} is already in use`, { constraint });
  }
  if (code === "23514") throw new ReservationError("VALIDATION", "Some values are out of range", { constraint });
  if (code === "23503") throw new ReservationError("INVALID_STATE", "This record is still in use and cannot be removed", { constraint });
  if (code === PG_EXCLUSION_VIOLATION) {
    throw new ReservationError("VEHICLE_UNAVAILABLE", "That period overlaps a reservation or another maintenance block", { constraint });
  }
  throw err;
}

async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    friendly(err);
  }
}

// ---------------------------------------------------------------------------------------------
// Branches
// ---------------------------------------------------------------------------------------------

export const branchInput = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{2,16}$/, "2-16 letters, digits or dashes"),
  name: z.string().trim().min(2).max(120),
  city: z.string().trim().min(2).max(80),
  emirate: z.string().trim().min(2).max(80),
  addressLine: z.string().trim().min(3).max(300),
  phone: optText(40),
  email: z.email().nullish(),
  timeZone: z.string().refine((tz) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, "Unknown time zone").default("Asia/Dubai"),
  latitude: z.number().min(-90).max(90).nullish(),
  longitude: z.number().min(-180).max(180).nullish(),
  opensAt: hhmm.default("08:00"),
  closesAt: hhmm.default("22:00"),
  is24Hours: z.boolean().default(false),
  isActive: z.boolean().default(true),
});
export type BranchInput = z.input<typeof branchInput>;

export async function createBranch(adminId: string, input: BranchInput) {
  const v = parse(branchInput, input);
  return guarded(() =>
    db.transaction(async (tx) => {
      const [row] = await tx.insert(branches).values(v).returning();
      await audit(tx, { actorUserId: adminId, action: "branch.created", entityType: "branch", entityId: row.id, data: v });
      return row;
    }),
  );
}

export async function updateBranch(adminId: string, id: string, input: Partial<BranchInput>) {
  if (!isUuid(id)) throw new ReservationError("NOT_FOUND", "Branch not found");
  const v = parse(branchInput.partial(), input);
  return guarded(() =>
    db.transaction(async (tx) => {
      const [row] = await tx.update(branches).set(v).where(eq(branches.id, id)).returning();
      if (!row) throw new ReservationError("NOT_FOUND", "Branch not found");
      await audit(tx, { actorUserId: adminId, action: "branch.updated", entityType: "branch", entityId: id, data: v });
      return row;
    }),
  );
}

// ---------------------------------------------------------------------------------------------
// Categories and features
// ---------------------------------------------------------------------------------------------

export const categoryInput = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_]{2,24}$/),
  name: z.string().trim().min(2).max(80),
  description: optText(1000),
  dailyRateFils: posFils,
  depositFils: fils,
  minDriverAge: z.number().int().min(18).max(99).default(21),
  sortOrder: z.number().int().default(0),
});
export type CategoryInput = z.input<typeof categoryInput>;

export async function createCategory(adminId: string, input: CategoryInput) {
  const v = parse(categoryInput, input);
  return guarded(() =>
    db.transaction(async (tx) => {
      const [row] = await tx.insert(vehicleCategories).values(v).returning();
      await audit(tx, { actorUserId: adminId, action: "category.created", entityType: "vehicle_category", entityId: row.id, data: v });
      return row;
    }),
  );
}

export async function updateCategory(adminId: string, id: string, input: Partial<CategoryInput>) {
  if (!isUuid(id)) throw new ReservationError("NOT_FOUND", "Category not found");
  const v = parse(categoryInput.partial(), input);
  return guarded(() =>
    db.transaction(async (tx) => {
      const [row] = await tx.update(vehicleCategories).set(v).where(eq(vehicleCategories.id, id)).returning();
      if (!row) throw new ReservationError("NOT_FOUND", "Category not found");
      await audit(tx, { actorUserId: adminId, action: "category.updated", entityType: "vehicle_category", entityId: id, data: v });
      return row;
    }),
  );
}

export async function createFeature(adminId: string, input: { code: string; name: string; icon?: string | null }) {
  const v = parse(z.object({ code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_]{2,32}$/), name: z.string().trim().min(2).max(80), icon: optText(40) }), input);
  return guarded(async () => {
    const [row] = await db.insert(vehicleFeatures).values(v).returning();
    await audit(db, { actorUserId: adminId, action: "feature.created", entityType: "vehicle_feature", entityId: row.id, data: v });
    return row;
  });
}

// ---------------------------------------------------------------------------------------------
// Vehicles
// ---------------------------------------------------------------------------------------------

export const vehicleInput = z.object({
  categoryId: uuid,
  branchId: uuid,
  plateNumber: z.string().trim().toUpperCase().min(2).max(20),
  vin: z.string().trim().toUpperCase().regex(/^[A-HJ-NPR-Z0-9]{17}$/, "A VIN has 17 characters (no I, O or Q)"),
  make: z.string().trim().min(1).max(60),
  model: z.string().trim().min(1).max(60),
  year: z.number().int().min(1990).max(2100),
  color: optText(40),
  transmission: z.enum(["AUTOMATIC", "MANUAL"]),
  fuelType: z.enum(["PETROL", "DIESEL", "HYBRID", "ELECTRIC"]),
  seats: z.number().int().min(1).max(15),
  doors: z.number().int().min(2).max(6).default(4),
  luggage: z.number().int().min(0).max(12).default(2),
  mileageKm: z.number().int().min(0).default(0),
  dailyRateFils: posFils.nullish(),
  photos: z.array(z.string().min(1).max(500)).max(20).default([]),
  description: optText(2000),
  featureIds: z.array(uuid).max(50).optional(),
});
export type VehicleInput = z.input<typeof vehicleInput>;

async function setFeatures(tx: DbOrTx, vehicleId: string, featureIds: string[]) {
  await tx.delete(vehicleFeatureMap).where(eq(vehicleFeatureMap.vehicleId, vehicleId));
  const unique = [...new Set(featureIds)];
  if (unique.length) await tx.insert(vehicleFeatureMap).values(unique.map((featureId) => ({ vehicleId, featureId })));
}

export async function createVehicle(adminId: string, input: VehicleInput) {
  const { featureIds, ...v } = parse(vehicleInput, input);
  return guarded(() =>
    db.transaction(async (tx) => {
      const [row] = await tx.insert(vehicles).values(v).returning();
      if (featureIds) await setFeatures(tx, row.id, featureIds);
      await audit(tx, { actorUserId: adminId, action: "vehicle.created", entityType: "vehicle", entityId: row.id, data: { plateNumber: row.plateNumber } });
      return row;
    }),
  );
}

/** Updates fleet details. Status changes go through setVehicleStatus. */
export async function updateVehicle(adminId: string, id: string, input: Partial<VehicleInput>) {
  if (!isUuid(id)) throw new ReservationError("NOT_FOUND", "Vehicle not found");
  const { featureIds, ...v } = parse(vehicleInput.partial(), input);
  return guarded(() =>
    db.transaction(async (tx) => {
      const [cur] = await tx.select().from(vehicles).where(eq(vehicles.id, id)).for("update");
      if (!cur) throw new ReservationError("NOT_FOUND", "Vehicle not found");
      if (v.branchId && v.branchId !== cur.branchId && cur.status === "ON_RENT") {
        throw new ReservationError("INVALID_STATE", "A vehicle on rent cannot be moved to another branch");
      }
      if (v.mileageKm !== undefined && v.mileageKm < cur.mileageKm) throw new ReservationError("VALIDATION", "Mileage cannot go down");
      const [row] = Object.keys(v).length ? await tx.update(vehicles).set(v).where(eq(vehicles.id, id)).returning() : [cur];
      if (featureIds) await setFeatures(tx, id, featureIds);
      await audit(tx, { actorUserId: adminId, action: "vehicle.updated", entityType: "vehicle", entityId: id, data: { ...v, featureIds } });
      return row;
    }),
  );
}

/**
 * Sets MAINTENANCE or RETIRED (blocks new bookings; existing ones are kept and listed for staff),
 * or AVAILABLE to return it to service (RESERVED/ON_RENT are then derived from its reservations).
 */
export async function setVehicleStatus(adminId: string, id: string, status: "AVAILABLE" | "MAINTENANCE" | "RETIRED", now = new Date()) {
  if (!isUuid(id)) throw new ReservationError("NOT_FOUND", "Vehicle not found");
  parse(z.enum(["AVAILABLE", "MAINTENANCE", "RETIRED"]), status);
  return db.transaction(async (tx) => {
    const [cur] = await tx.select().from(vehicles).where(eq(vehicles.id, id)).for("update");
    if (!cur) throw new ReservationError("NOT_FOUND", "Vehicle not found");
    if (cur.status === "ON_RENT" && status !== "AVAILABLE") throw new ReservationError("INVALID_STATE", "Check the vehicle in before taking it out of service");
    await tx.update(vehicles).set({ status }).where(eq(vehicles.id, id));
    if (status === "AVAILABLE") await refreshVehicleStatus(tx, id, now);
    const [row] = await tx.select().from(vehicles).where(eq(vehicles.id, id));
    await audit(tx, { actorUserId: adminId, action: "vehicle.status", entityType: "vehicle", entityId: id, data: { from: cur.status, to: row.status } });
    return row;
  });
}

// ---------------------------------------------------------------------------------------------
// Pricing rules
// ---------------------------------------------------------------------------------------------

const ruleBase = {
  name: z.string().trim().min(2).max(120),
  categoryId: uuid.nullish(),
  priority: z.number().int().min(-1000).max(1000).default(0),
  isActive: z.boolean().default(true),
};
export const pricingRuleInput = z.discriminatedUnion("type", [
  z.object({ ...ruleBase, type: z.literal("SEASONAL"), validFrom: dateStr, validTo: dateStr, adjustmentBps: z.number().int().min(-9000).max(30000) }),
  z.object({ ...ruleBase, type: z.literal("DURATION_DISCOUNT"), minDays: z.number().int().min(2).max(365), adjustmentBps: z.number().int().min(-9000).max(0) }),
  z.object({ ...ruleBase, type: z.literal("ONE_WAY_FEE"), pickupBranchId: uuid.nullish(), returnBranchId: uuid.nullish(), amountFils: fils }),
]);
export type PricingRuleInput = z.input<typeof pricingRuleInput>;

export async function savePricingRule(adminId: string, input: PricingRuleInput, id?: string) {
  const v = parse(pricingRuleInput, input);
  const values = {
    pickupBranchId: null,
    returnBranchId: null,
    validFrom: null,
    validTo: null,
    minDays: null,
    adjustmentBps: null,
    amountFils: null,
    categoryId: null,
    ...v,
  };
  return guarded(() =>
    db.transaction(async (tx) => {
      const [row] = id
        ? await tx.update(pricingRules).set(values).where(eq(pricingRules.id, id)).returning()
        : await tx.insert(pricingRules).values(values).returning();
      if (!row) throw new ReservationError("NOT_FOUND", "Pricing rule not found");
      await audit(tx, { actorUserId: adminId, action: id ? "pricing_rule.updated" : "pricing_rule.created", entityType: "pricing_rule", entityId: row.id, data: values });
      return row;
    }),
  );
}

export async function deletePricingRule(adminId: string, id: string) {
  if (!isUuid(id)) throw new ReservationError("NOT_FOUND", "Pricing rule not found");
  const [row] = await db.delete(pricingRules).where(eq(pricingRules.id, id)).returning();
  if (!row) throw new ReservationError("NOT_FOUND", "Pricing rule not found");
  await audit(db, { actorUserId: adminId, action: "pricing_rule.deleted", entityType: "pricing_rule", entityId: id, data: { name: row.name } });
  return row;
}

// ---------------------------------------------------------------------------------------------
// Extras
// ---------------------------------------------------------------------------------------------

export const extraInput = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_]{2,32}$/),
  name: z.string().trim().min(2).max(80),
  description: optText(500),
  pricing: z.enum(["PER_DAY", "PER_RENTAL"]),
  priceFils: fils,
  maxQuantity: z.number().int().min(1).max(10).default(1),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
});
export type ExtraInputData = z.input<typeof extraInput>;

export async function saveExtra(adminId: string, input: ExtraInputData, id?: string) {
  const v = parse(id ? extraInput.partial() : extraInput, input);
  return guarded(() =>
    db.transaction(async (tx) => {
      const [row] = id
        ? await tx.update(extras).set(v).where(eq(extras.id, id)).returning()
        : await tx.insert(extras).values(v as z.output<typeof extraInput>).returning();
      if (!row) throw new ReservationError("NOT_FOUND", "Extra not found");
      await audit(tx, { actorUserId: adminId, action: id ? "extra.updated" : "extra.created", entityType: "extra", entityId: row.id, data: v });
      return row;
    }),
  );
}

// ---------------------------------------------------------------------------------------------
// Maintenance blocks
// ---------------------------------------------------------------------------------------------

export const maintenanceInput = z
  .object({ vehicleId: uuid, startsAt: z.date(), endsAt: z.date(), reason: z.string().trim().min(2).max(500) })
  .refine((v) => v.endsAt > v.startsAt, { message: "The end must be after the start", path: ["endsAt"] });
export type MaintenanceInput = z.input<typeof maintenanceInput>;

/** Blocks a vehicle for maintenance. Throws VEHICLE_UNAVAILABLE if it overlaps a reservation or another block. */
export async function createMaintenanceBlock(adminId: string, input: MaintenanceInput) {
  const v = parse(maintenanceInput, input);
  return guarded(() =>
    db.transaction(async (tx) => {
      // Same lock as the reservation transaction, so a block and a booking cannot race.
      const [veh] = await tx.select({ id: vehicles.id }).from(vehicles).where(eq(vehicles.id, v.vehicleId)).for("update");
      if (!veh) throw new ReservationError("NOT_FOUND", "Vehicle not found");
      const [row] = await tx.insert(maintenanceBlocks).values({ ...v, createdBy: adminId }).returning();
      await audit(tx, { actorUserId: adminId, action: "maintenance.created", entityType: "maintenance_block", entityId: row.id, data: v });
      return row;
    }),
  );
}

export async function updateMaintenanceBlock(adminId: string, id: string, input: { startsAt?: Date; endsAt?: Date; reason?: string }) {
  if (!isUuid(id)) throw new ReservationError("NOT_FOUND", "Maintenance block not found");
  return guarded(() =>
    db.transaction(async (tx) => {
      const [cur] = await tx.select().from(maintenanceBlocks).where(eq(maintenanceBlocks.id, id));
      if (!cur) throw new ReservationError("NOT_FOUND", "Maintenance block not found");
      const v = parse(maintenanceInput, { vehicleId: cur.vehicleId, startsAt: input.startsAt ?? cur.startsAt, endsAt: input.endsAt ?? cur.endsAt, reason: input.reason ?? cur.reason });
      await tx.select({ id: vehicles.id }).from(vehicles).where(eq(vehicles.id, cur.vehicleId)).for("update");
      const [row] = await tx.update(maintenanceBlocks).set({ startsAt: v.startsAt, endsAt: v.endsAt, reason: v.reason }).where(eq(maintenanceBlocks.id, id)).returning();
      await audit(tx, { actorUserId: adminId, action: "maintenance.updated", entityType: "maintenance_block", entityId: id, data: v });
      return row;
    }),
  );
}

export async function deleteMaintenanceBlock(adminId: string, id: string) {
  if (!isUuid(id)) throw new ReservationError("NOT_FOUND", "Maintenance block not found");
  const [row] = await db.delete(maintenanceBlocks).where(eq(maintenanceBlocks.id, id)).returning();
  if (!row) throw new ReservationError("NOT_FOUND", "Maintenance block not found");
  await audit(db, { actorUserId: adminId, action: "maintenance.deleted", entityType: "maintenance_block", entityId: id });
  return row;
}

export async function listMaintenanceBlocks(f: { vehicleId?: string; from?: Date; to?: Date } = {}) {
  return db
    .select({ block: maintenanceBlocks, vehicle: { id: vehicles.id, make: vehicles.make, model: vehicles.model, plateNumber: vehicles.plateNumber } })
    .from(maintenanceBlocks)
    .innerJoin(vehicles, eq(vehicles.id, maintenanceBlocks.vehicleId))
    .where(
      and(
        f.vehicleId && isUuid(f.vehicleId) ? eq(maintenanceBlocks.vehicleId, f.vehicleId) : undefined,
        f.to ? lt(maintenanceBlocks.startsAt, f.to) : undefined,
        f.from ? gt(maintenanceBlocks.endsAt, f.from) : undefined,
      ),
    )
    .orderBy(asc(maintenanceBlocks.startsAt));
}
