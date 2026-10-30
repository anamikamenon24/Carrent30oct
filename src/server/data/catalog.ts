/**
 * Read-only catalogue queries: branches, categories, extras, features, vehicles, pricing rules.
 * Safe for public pages (no personal data).
 */
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type DbOrTx } from "@/server/db";
import {
  branches,
  extras,
  pricingRules,
  vehicleCategories,
  vehicleFeatureMap,
  vehicleFeatures,
  vehicles,
} from "@/server/db/schema";

export type Branch = typeof branches.$inferSelect;
export type VehicleCategory = typeof vehicleCategories.$inferSelect;
export type Extra = typeof extras.$inferSelect;
export type VehicleFeature = typeof vehicleFeatures.$inferSelect;
export type PricingRule = typeof pricingRules.$inferSelect;
export type VehicleRow = typeof vehicles.$inferSelect;

export interface VehicleSummary {
  id: string;
  plateNumber: string;
  make: string;
  model: string;
  year: number;
  color: string | null;
  transmission: VehicleRow["transmission"];
  fuelType: VehicleRow["fuelType"];
  seats: number;
  doors: number;
  luggage: number;
  photos: string[];
  description: string | null;
  status: VehicleRow["status"];
  branchId: string;
  /** Base daily rate (vehicle override, else category rate), before seasonal rules. */
  dailyRateFils: number;
  depositFils: number;
  category: { id: string; code: string; name: string; minDriverAge: number };
  features: { id: string; code: string; name: string; icon: string | null }[];
}

export interface VehicleDetail extends VehicleSummary {
  vin: string;
  mileageKm: number;
  branch: Branch;
}

export const isUuid = (v: unknown): boolean => typeof v === "string" && z.uuid().safeParse(v).success;

export async function listBranches(opts: { includeInactive?: boolean } = {}, conn: DbOrTx = db): Promise<Branch[]> {
  return conn
    .select()
    .from(branches)
    .where(opts.includeInactive ? undefined : eq(branches.isActive, true))
    .orderBy(asc(branches.emirate), asc(branches.name));
}

/** By id (uuid) or by code (e.g. "DXB-APT"). */
export async function getBranch(idOrCode: string, conn: DbOrTx = db): Promise<Branch | null> {
  const where = isUuid(idOrCode) ? eq(branches.id, idOrCode) : eq(branches.code, idOrCode.toUpperCase());
  const [row] = await conn.select().from(branches).where(where).limit(1);
  return row ?? null;
}

export const getBranchByCode = (code: string) => getBranch(code);

export async function listCategories(conn: DbOrTx = db): Promise<VehicleCategory[]> {
  return conn.select().from(vehicleCategories).orderBy(asc(vehicleCategories.sortOrder), asc(vehicleCategories.name));
}

export async function listExtras(opts: { includeInactive?: boolean } = {}, conn: DbOrTx = db): Promise<Extra[]> {
  return conn
    .select()
    .from(extras)
    .where(opts.includeInactive ? undefined : eq(extras.isActive, true))
    .orderBy(asc(extras.sortOrder), asc(extras.name));
}

export async function listFeatures(conn: DbOrTx = db): Promise<VehicleFeature[]> {
  return conn.select().from(vehicleFeatures).orderBy(asc(vehicleFeatures.name));
}

export async function listPricingRules(opts: { activeOnly?: boolean } = {}, conn: DbOrTx = db): Promise<PricingRule[]> {
  return conn
    .select()
    .from(pricingRules)
    .where(opts.activeOnly ? eq(pricingRules.isActive, true) : undefined)
    .orderBy(asc(pricingRules.type), sql`${pricingRules.priority} desc`, asc(pricingRules.name));
}

const vehicleColumns = {
  vehicle: vehicles,
  category: {
    id: vehicleCategories.id,
    code: vehicleCategories.code,
    name: vehicleCategories.name,
    minDriverAge: vehicleCategories.minDriverAge,
    dailyRateFils: vehicleCategories.dailyRateFils,
    depositFils: vehicleCategories.depositFils,
  },
};

async function featuresFor(conn: DbOrTx, vehicleIds: string[]) {
  const map = new Map<string, VehicleSummary["features"]>();
  if (!vehicleIds.length) return map;
  const rows = await conn
    .select({
      vehicleId: vehicleFeatureMap.vehicleId,
      id: vehicleFeatures.id,
      code: vehicleFeatures.code,
      name: vehicleFeatures.name,
      icon: vehicleFeatures.icon,
    })
    .from(vehicleFeatureMap)
    .innerJoin(vehicleFeatures, eq(vehicleFeatures.id, vehicleFeatureMap.featureId))
    .where(inArray(vehicleFeatureMap.vehicleId, vehicleIds))
    .orderBy(asc(vehicleFeatures.name));
  for (const { vehicleId, ...f } of rows) {
    const list = map.get(vehicleId) ?? [];
    list.push(f);
    map.set(vehicleId, list);
  }
  return map;
}

interface JoinedVehicle {
  vehicle: VehicleRow;
  category: { id: string; code: string; name: string; minDriverAge: number; dailyRateFils: number; depositFils: number };
}

function toSummary(row: JoinedVehicle, features: VehicleSummary["features"]): VehicleSummary {
  const v = row.vehicle;
  return {
    id: v.id,
    plateNumber: v.plateNumber,
    make: v.make,
    model: v.model,
    year: v.year,
    color: v.color,
    transmission: v.transmission,
    fuelType: v.fuelType,
    seats: v.seats,
    doors: v.doors,
    luggage: v.luggage,
    photos: v.photos,
    description: v.description,
    status: v.status,
    branchId: v.branchId,
    dailyRateFils: v.dailyRateFils ?? row.category.dailyRateFils,
    depositFils: row.category.depositFils,
    category: { id: row.category.id, code: row.category.code, name: row.category.name, minDriverAge: row.category.minDriverAge },
    features,
  };
}

/** Loads vehicles (with category and features) by id, in the given order. */
export async function getVehicleSummaries(ids: string[], conn: DbOrTx = db): Promise<VehicleSummary[]> {
  if (!ids.length) return [];
  const rows = await conn
    .select(vehicleColumns)
    .from(vehicles)
    .innerJoin(vehicleCategories, eq(vehicleCategories.id, vehicles.categoryId))
    .where(inArray(vehicles.id, ids));
  const feats = await featuresFor(conn, ids);
  const byId = new Map(rows.map((r) => [r.vehicle.id, toSummary(r, feats.get(r.vehicle.id) ?? [])]));
  return ids.flatMap((id) => byId.get(id) ?? []);
}

export async function getVehicle(id: string, conn: DbOrTx = db): Promise<VehicleDetail | null> {
  if (!isUuid(id)) return null;
  const [row] = await conn
    .select({ ...vehicleColumns, branch: branches })
    .from(vehicles)
    .innerJoin(vehicleCategories, eq(vehicleCategories.id, vehicles.categoryId))
    .innerJoin(branches, eq(branches.id, vehicles.branchId))
    .where(eq(vehicles.id, id))
    .limit(1);
  if (!row) return null;
  const feats = await featuresFor(conn, [id]);
  return { ...toSummary(row, feats.get(id) ?? []), vin: row.vehicle.vin, mileageKm: row.vehicle.mileageKm, branch: row.branch };
}

export interface ListVehiclesFilter {
  branchId?: string;
  categoryId?: string;
  status?: VehicleRow["status"][];
}

/** Fleet list (admin or browse-all). Not availability-aware: use searchVehicles for that. */
export async function listVehicles(filter: ListVehiclesFilter = {}, conn: DbOrTx = db): Promise<VehicleSummary[]> {
  const rows = await conn
    .select(vehicleColumns)
    .from(vehicles)
    .innerJoin(vehicleCategories, eq(vehicleCategories.id, vehicles.categoryId))
    .where(
      and(
        filter.branchId ? eq(vehicles.branchId, filter.branchId) : undefined,
        filter.categoryId ? eq(vehicles.categoryId, filter.categoryId) : undefined,
        filter.status?.length ? inArray(vehicles.status, filter.status) : undefined,
      ),
    )
    .orderBy(asc(vehicleCategories.sortOrder), asc(vehicles.make), asc(vehicles.model), asc(vehicles.plateNumber));
  const feats = await featuresFor(conn, rows.map((r) => r.vehicle.id));
  return rows.map((r) => toSummary(r, feats.get(r.vehicle.id) ?? []));
}
