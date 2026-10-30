/**
 * Availability: search, per-vehicle busy intervals / calendar, and the conflict check used inside the
 * reservation transaction.
 *
 * A vehicle is available for [from, to) when:
 *  - its status is not RETIRED or MAINTENANCE;
 *  - no vehicle_occupancy row (active reservation or maintenance block) overlaps [from, to).
 *    PENDING holds whose hold_expires_at has passed do not count, even before the cleanup job runs;
 *  - it will be at the pick-up branch: the return branch of its last active reservation ending at or before
 *    `from`, else its current branch;
 *  - its next active reservation after `to` (if any) starts at the requested return branch.
 */
import { sql, type SQL } from "drizzle-orm";
import { addDaysToKey, localToUtc } from "@/lib/tz";
import { db, type DbOrTx } from "@/server/db";
import { computeQuote, type Quote } from "@/server/pricing";
import { getBranch, getVehicle, getVehicleSummaries, isUuid, listPricingRules, type VehicleSummary } from "@/server/data/catalog";
import { ReservationError } from "./errors";

const ts = (d: Date) => sql`${d.toISOString()}::timestamptz`;
const range = (from: Date, to: Date) => sql`tstzrange(${ts(from)}, ${ts(to)}, '[)')`;

/** Occupancy rows that really block (ignores lapsed holds). */
function blockingOccupancy(vehicleId: SQL, from: Date, to: Date, now: Date, excludeReservationId?: string): SQL {
  return sql`select 1 from vehicle_occupancy o
    left join reservations r on r.id = o.reservation_id
    where o.vehicle_id = ${vehicleId}
      and o.period && ${range(from, to)}
      and not (r.status is not null and r.status = 'PENDING' and r.hold_expires_at <= ${ts(now)})
      ${excludeReservationId ? sql`and o.reservation_id is distinct from ${excludeReservationId}::uuid` : sql``}`;
}

function liveReservation(alias: "pr" | "nr", now: Date, excludeReservationId?: string): SQL {
  const a = sql.raw(alias);
  return sql`${a}.status in ('PENDING', 'CONFIRMED', 'PICKED_UP')
    and not (${a}.status = 'PENDING' and ${a}.hold_expires_at <= ${ts(now)})
    ${excludeReservationId ? sql`and ${a}.id <> ${excludeReservationId}::uuid` : sql``}`;
}

/** Branch the vehicle will be at when `from` arrives. */
function locationAt(vehicleId: SQL, from: Date, now: Date, excludeReservationId?: string): SQL {
  return sql`coalesce((select pr.return_branch_id from reservations pr
      where pr.vehicle_id = ${vehicleId} and ${liveReservation("pr", now, excludeReservationId)} and pr.return_at <= ${ts(from)}
      order by pr.return_at desc limit 1), (select vv.branch_id from vehicles vv where vv.id = ${vehicleId}))`;
}

/** Pick-up branch of the next booking after `to`, or null. */
function nextPickupBranch(vehicleId: SQL, to: Date, now: Date, excludeReservationId?: string): SQL {
  return sql`(select nr.pickup_branch_id from reservations nr
      where nr.vehicle_id = ${vehicleId} and ${liveReservation("nr", now, excludeReservationId)} and nr.pickup_at >= ${ts(to)}
      order by nr.pickup_at asc limit 1)`;
}

export type AvailabilityConflict = "OCCUPIED" | "NOT_AT_PICKUP_BRANCH" | "NEXT_BOOKING_ELSEWHERE";

export interface AvailabilityCheck {
  vehicleId: string;
  pickupBranchId: string;
  returnBranchId: string;
  from: Date;
  to: Date;
  now?: Date;
  /** Ignore this reservation (when changing its own dates). */
  excludeReservationId?: string;
}

/** Returns why the vehicle is not available, or null when it is. Run inside the transaction that books it. */
export async function findAvailabilityConflict(conn: DbOrTx, c: AvailabilityCheck): Promise<AvailabilityConflict | null> {
  const now = c.now ?? new Date();
  const vid = sql`${c.vehicleId}::uuid`;
  const { rows } = await conn.execute<{ occupied: boolean; location: string; next_branch: string | null }>(sql`
    select exists(${blockingOccupancy(vid, c.from, c.to, now, c.excludeReservationId)}) as occupied,
           ${locationAt(vid, c.from, now, c.excludeReservationId)} as location,
           ${nextPickupBranch(vid, c.to, now, c.excludeReservationId)} as next_branch`);
  const r = rows[0];
  if (r.occupied) return "OCCUPIED";
  if (r.location !== c.pickupBranchId) return "NOT_AT_PICKUP_BRANCH";
  if (r.next_branch && r.next_branch !== c.returnBranchId) return "NEXT_BOOKING_ELSEWHERE";
  return null;
}

export interface SearchVehiclesInput {
  pickupBranchId: string;
  returnBranchId: string;
  start: Date;
  end: Date;
  categoryId?: string;
  transmission?: "AUTOMATIC" | "MANUAL";
  minSeats?: number;
  fuel?: "PETROL" | "DIESEL" | "HYBRID" | "ELECTRIC";
  /** Filters on the average daily rate for this period (after seasonal rules). */
  minDailyFils?: number;
  maxDailyFils?: number;
  sort?: "price_asc" | "price_desc" | "seats_desc";
  now?: Date;
}

export interface SearchResult extends VehicleSummary {
  /** Price for this vehicle and period without extras. */
  quote: Pick<
    Quote,
    "days" | "averageDailyRateFils" | "rentalFils" | "discountFils" | "oneWayFeeFils" | "vatFils" | "totalFils" | "depositFils"
  >;
}

function assertPeriod(start: Date, end: Date) {
  if (!(start instanceof Date) || !(end instanceof Date) || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new ReservationError("VALIDATION", "Choose valid pick-up and return times");
  }
  if (end <= start) throw new ReservationError("VALIDATION", "Return must be after pick-up");
}

/** Vehicles available for the whole period at the pick-up branch, priced for that period. */
export async function searchVehicles(input: SearchVehiclesInput, conn: DbOrTx = db): Promise<SearchResult[]> {
  assertPeriod(input.start, input.end);
  if (!isUuid(input.pickupBranchId) || !isUuid(input.returnBranchId)) {
    throw new ReservationError("VALIDATION", "Choose pick-up and return branches");
  }
  const now = input.now ?? new Date();
  const pickupBranch = await getBranch(input.pickupBranchId, conn);
  const returnBranch = await getBranch(input.returnBranchId, conn);
  if (!pickupBranch?.isActive || !returnBranch?.isActive) throw new ReservationError("NOT_FOUND", "Branch not found");

  const vid = sql`v.id`;
  const { rows } = await conn.execute<{ id: string }>(sql`
    select v.id from vehicles v
    where v.status not in ('RETIRED', 'MAINTENANCE')
      ${input.categoryId && isUuid(input.categoryId) ? sql`and v.category_id = ${input.categoryId}::uuid` : sql``}
      ${input.transmission ? sql`and v.transmission = ${input.transmission}` : sql``}
      ${input.fuel ? sql`and v.fuel_type = ${input.fuel}` : sql``}
      ${input.minSeats ? sql`and v.seats >= ${input.minSeats}` : sql``}
      and not exists (${blockingOccupancy(vid, input.start, input.end, now)})
      and ${locationAt(vid, input.start, now)} = ${input.pickupBranchId}::uuid
      and coalesce(${nextPickupBranch(vid, input.end, now)}, ${input.returnBranchId}::uuid) = ${input.returnBranchId}::uuid`);

  const vehicles = await getVehicleSummaries(rows.map((r) => r.id), conn);
  const rules = await listPricingRules({ activeOnly: true }, conn);
  const results: SearchResult[] = vehicles.map((v) => {
    const q = computeQuote({
      categoryId: v.category.id,
      baseDailyRateFils: v.dailyRateFils,
      depositFils: v.depositFils,
      pickupBranchId: input.pickupBranchId,
      returnBranchId: input.returnBranchId,
      timeZone: pickupBranch.timeZone,
      pickupAt: input.start,
      returnAt: input.end,
      rules,
      extras: [],
    });
    return {
      ...v,
      quote: {
        days: q.days,
        averageDailyRateFils: q.averageDailyRateFils,
        rentalFils: q.rentalFils,
        discountFils: q.discountFils,
        oneWayFeeFils: q.oneWayFeeFils,
        vatFils: q.vatFils,
        totalFils: q.totalFils,
        depositFils: q.depositFils,
      },
    };
  });
  const filtered = results.filter(
    (r) =>
      (input.minDailyFils === undefined || r.quote.averageDailyRateFils >= input.minDailyFils) &&
      (input.maxDailyFils === undefined || r.quote.averageDailyRateFils <= input.maxDailyFils),
  );
  const sort = input.sort ?? "price_asc";
  filtered.sort((a, b) =>
    sort === "seats_desc"
      ? b.seats - a.seats || a.quote.totalFils - b.quote.totalFils
      : sort === "price_desc"
        ? b.quote.totalFils - a.quote.totalFils
        : a.quote.totalFils - b.quote.totalFils,
  );
  return filtered;
}

export interface BusyInterval {
  start: Date;
  end: Date;
  kind: "RESERVATION" | "MAINTENANCE";
}

/** Periods in [from, to) when the vehicle is booked or in maintenance (no customer details). */
export async function getVehicleBusyIntervals(
  vehicleId: string,
  from: Date,
  to: Date,
  opts: { now?: Date } = {},
  conn: DbOrTx = db,
): Promise<BusyInterval[]> {
  if (!isUuid(vehicleId)) return [];
  assertPeriod(from, to);
  const now = opts.now ?? new Date();
  const { rows } = await conn.execute<{ start: string | Date; end: string | Date; kind: BusyInterval["kind"] }>(sql`
    select lower(o.period) as start, upper(o.period) as "end", o.kind from vehicle_occupancy o
    left join reservations r on r.id = o.reservation_id
    where o.vehicle_id = ${vehicleId}::uuid and o.period && ${range(from, to)}
      and not (r.status is not null and r.status = 'PENDING' and r.hold_expires_at <= ${ts(now)})
    order by lower(o.period)`);
  return rows.map((r) => ({ start: new Date(r.start), end: new Date(r.end), kind: r.kind }));
}

export interface CalendarDay {
  /** Local date "YYYY-MM-DD" in the vehicle's branch time zone. */
  date: string;
  status: "AVAILABLE" | "PARTIAL" | "UNAVAILABLE";
}

/**
 * Day-by-day availability for a calendar, in the time zone of the vehicle's current branch.
 * PARTIAL = busy for part of the day (e.g. a rental ends at 10:00).
 */
export async function getVehicleAvailabilityCalendar(
  vehicleId: string,
  fromDate: string,
  days: number,
  opts: { now?: Date } = {},
  conn: DbOrTx = db,
): Promise<{ timeZone: string; days: CalendarDay[]; busy: BusyInterval[] }> {
  const vehicle = await getVehicle(vehicleId, conn);
  if (!vehicle) throw new ReservationError("NOT_FOUND", "Vehicle not found");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !(days >= 1 && days <= 366)) {
    throw new ReservationError("VALIDATION", "Invalid calendar range");
  }
  const tz = vehicle.branch.timeZone;
  const keys = Array.from({ length: days }, (_, i) => addDaysToKey(fromDate, i));
  const bounds = [...keys, addDaysToKey(fromDate, days)].map((k) => localToUtc(`${k}T00:00`, tz));
  const busy = await getVehicleBusyIntervals(vehicleId, bounds[0], bounds[days], opts, conn);
  const unrentable = vehicle.status === "RETIRED" || vehicle.status === "MAINTENANCE";
  return {
    timeZone: tz,
    busy,
    days: keys.map((date, i) => {
      if (unrentable) return { date, status: "UNAVAILABLE" };
      const start = bounds[i].getTime();
      const end = bounds[i + 1].getTime();
      let covered = 0;
      const overlaps = busy
        .map((b) => [Math.max(start, b.start.getTime()), Math.min(end, b.end.getTime())] as const)
        .filter(([s, e]) => e > s)
        .sort((a, b) => a[0] - b[0]);
      let cursor = start;
      for (const [s, e] of overlaps) {
        covered += Math.max(0, e - Math.max(s, cursor));
        cursor = Math.max(cursor, e);
      }
      return { date, status: covered === 0 ? "AVAILABLE" : covered >= end - start ? "UNAVAILABLE" : "PARTIAL" };
    }),
  };
}
