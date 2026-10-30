import "server-only";
import { notFound } from "next/navigation";
import { defaultTrip, parseCriteria, type SearchCriteria } from "@/lib/search-params";
import { localDateKey, localToUtc } from "@/lib/tz";
import { db } from "@/server/db";
import { getVehicle, listBranches, listExtras, type Branch, type Extra } from "@/server/data/catalog";
import { findAvailabilityConflict, type AvailabilityConflict } from "@/server/reservations/availability";
import { isReservationError } from "@/server/reservations/errors";
import { quoteReservation, type ExtraSelection } from "@/server/reservations/quote";
import type { Quote } from "@/server/pricing";

type RawParams = Record<string, string | string[] | undefined>;

export const CONFLICT_MESSAGES: Record<AvailabilityConflict, string> = {
  OCCUPIED: "This car is already booked for part of these dates. Pick other dates or another car.",
  NOT_AT_PICKUP_BRANCH: "This car won't be at the chosen pick-up branch at that time. Try another branch or car.",
  NEXT_BOOKING_ELSEWHERE: "This car has a later booking at another branch, so it must be returned there. Change the return branch or dates.",
};

/** Reads `extra=<code>` (repeated) and `qty_<code>=<n>` from the URL. */
export function selectedExtraCodes(sp: RawParams, extras: Extra[]): Record<string, number> {
  const raw = sp.extra;
  const codes = new Set((Array.isArray(raw) ? raw : raw ? [raw] : []).map(String));
  const out: Record<string, number> = {};
  for (const x of extras) {
    if (!codes.has(x.code)) continue;
    const q = Number(Array.isArray(sp[`qty_${x.code}`]) ? sp[`qty_${x.code}`]![0] : sp[`qty_${x.code}`]);
    out[x.code] = Number.isInteger(q) && q >= 1 ? Math.min(q, x.maxQuantity) : 1;
  }
  return out;
}

export function toExtraSelections(selected: Record<string, number>, extras: Extra[]): ExtraSelection[] {
  return extras.filter((x) => selected[x.code]).map((x) => ({ extraId: x.id, quantity: selected[x.code] }));
}

export interface BookingContext {
  vehicle: NonNullable<Awaited<ReturnType<typeof getVehicle>>>;
  branches: Branch[];
  extras: Extra[];
  pickupBranch: Branch;
  returnBranch: Branch;
  criteria: SearchCriteria & { start: string; end: string; pickup: string; dropoff: string };
  start: Date;
  end: Date;
  todayKey: string;
  selectedExtras: Record<string, number>;
  quote: Quote | null;
  /** Why these dates can't be booked (validation or availability), or null. */
  problem: string | null;
}

/** Loads the vehicle, trip and a server-side quote for the booking pages. 404s for unknown vehicles. */
export async function loadBookingContext(vehicleId: string, sp: RawParams): Promise<BookingContext> {
  const vehicle = await getVehicle(vehicleId);
  if (!vehicle || vehicle.status === "RETIRED") notFound();
  const [branches, extras] = await Promise.all([listBranches(), listExtras()]);
  const parsed = parseCriteria(sp);
  const pickupBranch = branches.find((b) => b.code === parsed.pickup) ?? branches.find((b) => b.id === vehicle.branchId) ?? branches[0];
  const returnBranch = branches.find((b) => b.code === parsed.dropoff) ?? pickupBranch;
  if (!pickupBranch) notFound();
  const todayKey = localDateKey(new Date(), pickupBranch.timeZone);
  const fallback = defaultTrip(todayKey);
  const criteria = {
    ...parsed,
    pickup: pickupBranch.code,
    dropoff: returnBranch.code,
    start: parsed.start ?? fallback.start,
    end: parsed.end ?? fallback.end,
  };
  const start = localToUtc(criteria.start, pickupBranch.timeZone);
  const end = localToUtc(criteria.end, pickupBranch.timeZone);
  const selectedExtras = selectedExtraCodes(sp, extras);

  let quote: Quote | null = null;
  let problem: string | null = null;
  if (vehicle.status === "MAINTENANCE") {
    problem = "This car is in the workshop and can't be booked right now.";
  } else if (end <= start) {
    problem = "Return must be after pick-up.";
  } else {
    try {
      quote = await quoteReservation({
        vehicleId: vehicle.id,
        pickupBranchId: pickupBranch.id,
        returnBranchId: returnBranch.id,
        pickupAt: start,
        returnAt: end,
        extras: toExtraSelections(selectedExtras, extras),
      });
      const conflict = await findAvailabilityConflict(db, {
        vehicleId: vehicle.id,
        pickupBranchId: pickupBranch.id,
        returnBranchId: returnBranch.id,
        from: start,
        to: end,
      });
      if (conflict) problem = CONFLICT_MESSAGES[conflict];
    } catch (err) {
      if (!isReservationError(err)) throw err;
      problem = err.message;
    }
  }

  return { vehicle, branches, extras, pickupBranch, returnBranch, criteria, start, end, todayKey, selectedExtras, quote, problem };
}
