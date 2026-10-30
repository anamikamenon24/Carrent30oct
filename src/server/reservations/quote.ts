import { and, eq, inArray } from "drizzle-orm";
import { utcToLocal } from "@/lib/tz";
import { db, type DbOrTx } from "@/server/db";
import { branches, extras as extrasTable, vehicleCategories, vehicles } from "@/server/db/schema";
import { computeQuote, rentalDays, type Quote } from "@/server/pricing";
import { isUuid, listPricingRules, type Branch } from "@/server/data/catalog";
import { ReservationError } from "./errors";
import { POLICY } from "./policy";

export interface ExtraSelection {
  extraId: string;
  quantity: number;
}

export interface QuoteRequest {
  vehicleId: string;
  pickupBranchId: string;
  returnBranchId: string;
  pickupAt: Date;
  returnAt: Date;
  extras?: ExtraSelection[];
}

const DAY = 86_400_000;

function isValidDate(d: unknown): d is Date {
  return d instanceof Date && !Number.isNaN(d.getTime());
}

function withinHours(branch: Branch, at: Date) {
  if (branch.is24Hours) return true;
  const hhmm = utcToLocal(at, branch.timeZone).slice(11, 16);
  return branch.opensAt.slice(0, 5) <= hhmm && hhmm <= branch.closesAt.slice(0, 5);
}

/** Checks the request shape and the booking-window policy. Throws ReservationError("VALIDATION"). */
export function validatePeriod(pickupAt: Date, returnAt: Date, now: Date) {
  if (!isValidDate(pickupAt) || !isValidDate(returnAt)) throw new ReservationError("VALIDATION", "Choose valid pick-up and return times");
  if (returnAt <= pickupAt) throw new ReservationError("VALIDATION", "Return must be after pick-up");
  if (returnAt.getTime() - pickupAt.getTime() < POLICY.minRentalMinutes * 60_000) {
    throw new ReservationError("VALIDATION", `The minimum rental is ${POLICY.minRentalMinutes} minutes`);
  }
  if (pickupAt.getTime() < now.getTime() + POLICY.minLeadMinutes * 60_000) {
    throw new ReservationError("VALIDATION", `Pick-up must be at least ${POLICY.minLeadMinutes} minutes from now`);
  }
  if (pickupAt.getTime() > now.getTime() + POLICY.maxAdvanceDays * DAY) {
    throw new ReservationError("VALIDATION", `Pick-up can be at most ${POLICY.maxAdvanceDays} days ahead`);
  }
  if (rentalDays(pickupAt, returnAt) > POLICY.maxRentalDays) {
    throw new ReservationError("VALIDATION", `The maximum rental is ${POLICY.maxRentalDays} days`);
  }
}

function normaliseExtras(list: ExtraSelection[] = []): ExtraSelection[] {
  const byId = new Map<string, number>();
  for (const e of list) {
    if (!isUuid(e.extraId)) throw new ReservationError("VALIDATION", "Unknown extra");
    if (!Number.isInteger(e.quantity) || e.quantity < 0) throw new ReservationError("VALIDATION", "Invalid extra quantity");
    if (e.quantity > 0) byId.set(e.extraId, (byId.get(e.extraId) ?? 0) + e.quantity);
  }
  return [...byId].map(([extraId, quantity]) => ({ extraId, quantity })).sort((a, b) => a.extraId.localeCompare(b.extraId));
}

export interface PricedRequest {
  vehicle: typeof vehicles.$inferSelect;
  category: typeof vehicleCategories.$inferSelect;
  pickupBranch: Branch;
  returnBranch: Branch;
  extras: ExtraSelection[];
  quote: Quote;
}

/**
 * Loads everything needed to price a request and prices it. Validates branches, hours, extras and the
 * booking window. Does not check availability.
 */
export async function priceRequest(conn: DbOrTx, req: QuoteRequest, now: Date): Promise<PricedRequest> {
  if (!isUuid(req.vehicleId)) throw new ReservationError("NOT_FOUND", "Vehicle not found");
  if (!isUuid(req.pickupBranchId) || !isUuid(req.returnBranchId)) throw new ReservationError("NOT_FOUND", "Branch not found");
  validatePeriod(req.pickupAt, req.returnAt, now);

  const [row] = await conn
    .select({ vehicle: vehicles, category: vehicleCategories })
    .from(vehicles)
    .innerJoin(vehicleCategories, eq(vehicleCategories.id, vehicles.categoryId))
    .where(eq(vehicles.id, req.vehicleId))
    .limit(1);
  if (!row) throw new ReservationError("NOT_FOUND", "Vehicle not found");

  const branchRows = await conn
    .select()
    .from(branches)
    .where(inArray(branches.id, [req.pickupBranchId, req.returnBranchId]));
  const pickupBranch = branchRows.find((b) => b.id === req.pickupBranchId);
  const returnBranch = branchRows.find((b) => b.id === req.returnBranchId);
  if (!pickupBranch?.isActive || !returnBranch?.isActive) throw new ReservationError("NOT_FOUND", "Branch not found");
  if (!withinHours(pickupBranch, req.pickupAt)) {
    throw new ReservationError("BRANCH_CLOSED", `${pickupBranch.name} is closed at the chosen pick-up time`);
  }
  if (!withinHours(returnBranch, req.returnAt)) {
    throw new ReservationError("BRANCH_CLOSED", `${returnBranch.name} is closed at the chosen return time`);
  }

  const selected = normaliseExtras(req.extras);
  const extraRows = selected.length
    ? await conn
        .select()
        .from(extrasTable)
        .where(and(inArray(extrasTable.id, selected.map((e) => e.extraId)), eq(extrasTable.isActive, true)))
    : [];
  const lines = selected.map((s) => {
    const extra = extraRows.find((x) => x.id === s.extraId);
    if (!extra) throw new ReservationError("VALIDATION", "An extra you chose is no longer offered");
    if (s.quantity > extra.maxQuantity) {
      throw new ReservationError("VALIDATION", `You can add at most ${extra.maxQuantity} x ${extra.name}`);
    }
    return { extra, quantity: s.quantity };
  });

  const rules = await listPricingRules({ activeOnly: true }, conn);
  const quote = computeQuote({
    categoryId: row.category.id,
    baseDailyRateFils: row.vehicle.dailyRateFils ?? row.category.dailyRateFils,
    depositFils: row.category.depositFils,
    pickupBranchId: pickupBranch.id,
    returnBranchId: returnBranch.id,
    timeZone: pickupBranch.timeZone,
    pickupAt: req.pickupAt,
    returnAt: req.returnAt,
    rules,
    extras: lines,
  });
  return { vehicle: row.vehicle, category: row.category, pickupBranch, returnBranch, extras: selected, quote };
}

/** Prices a prospective rental (no availability check, nothing written). */
export async function quoteReservation(req: QuoteRequest, opts: { now?: Date } = {}, conn: DbOrTx = db): Promise<Quote> {
  return (await priceRequest(conn, req, opts.now ?? new Date())).quote;
}
