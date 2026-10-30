import { addDaysToKey, isLocalDateTime } from "./tz";

/** Search/booking criteria carried in the URL between pages. Dates are wall-clock times in the pick-up branch zone. */
export interface SearchCriteria {
  pickup?: string; // branch code
  dropoff?: string; // branch code
  start?: string; // YYYY-MM-DDTHH:mm
  end?: string;
  category?: string;
  transmission?: "AUTOMATIC" | "MANUAL";
  seats?: number;
  fuel?: "PETROL" | "DIESEL" | "HYBRID" | "ELECTRIC";
  minPrice?: number; // AED per day
  maxPrice?: number;
  sort?: "price" | "-price";
}

type RawParams = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || undefined;

const TRANSMISSIONS = ["AUTOMATIC", "MANUAL"] as const;
const FUELS = ["PETROL", "DIESEL", "HYBRID", "ELECTRIC"] as const;

function joinLocal(date?: string, time?: string): string | undefined {
  if (!date) return undefined;
  const v = `${date}T${time || "10:00"}`;
  return isLocalDateTime(v) ? v : undefined;
}

function positiveNumber(v?: string): number | undefined {
  if (!v) return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** Parses URL search params. Accepts `start`/`end` or the separate `startDate`+`startTime` fields from the GET form. */
export function parseCriteria(sp: RawParams): SearchCriteria {
  const start = first(sp.start);
  const end = first(sp.end);
  const transmission = first(sp.transmission)?.toUpperCase();
  const fuel = first(sp.fuel)?.toUpperCase();
  const sort = first(sp.sort);
  return {
    pickup: first(sp.pickup)?.toUpperCase(),
    dropoff: first(sp.dropoff)?.toUpperCase(),
    start: start && isLocalDateTime(start) ? start : joinLocal(first(sp.startDate), first(sp.startTime)),
    end: end && isLocalDateTime(end) ? end : joinLocal(first(sp.endDate), first(sp.endTime)),
    category: first(sp.category),
    transmission: TRANSMISSIONS.find((t) => t === transmission),
    seats: positiveNumber(first(sp.seats)),
    fuel: FUELS.find((f) => f === fuel),
    minPrice: positiveNumber(first(sp.minPrice)),
    maxPrice: positiveNumber(first(sp.maxPrice)),
    sort: sort === "price" || sort === "-price" ? sort : undefined,
  };
}

/** Serializes criteria to a query string (without "?"). */
export function criteriaToQuery(c: SearchCriteria, overrides: Partial<Record<keyof SearchCriteria, string | number | undefined>> = {}): string {
  const params = new URLSearchParams();
  const merged = { ...c, ...overrides } as Record<string, string | number | undefined>;
  for (const key of ["pickup", "dropoff", "start", "end", "category", "transmission", "seats", "fuel", "minPrice", "maxPrice", "sort"]) {
    const v = merged[key];
    if (v !== undefined && v !== "") params.set(key, String(v));
  }
  return params.toString();
}

/** Only the trip part (branches + dates), used when moving from search to booking pages. */
export function tripQuery(c: SearchCriteria): string {
  return criteriaToQuery({ pickup: c.pickup, dropoff: c.dropoff, start: c.start, end: c.end });
}

/** Default trip: tomorrow 10:00 to three days later 10:00, given today's key in the branch zone. */
export function defaultTrip(todayKey: string): { start: string; end: string } {
  return { start: `${addDaysToKey(todayKey, 1)}T10:00`, end: `${addDaysToKey(todayKey, 4)}T10:00` };
}
