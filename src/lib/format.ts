/** Display helpers shared by server and client code. Money is always integer fils (1 AED = 100 fils). */

const aed = new Intl.NumberFormat("en-AE", {
  style: "currency",
  currency: "AED",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const aedWhole = new Intl.NumberFormat("en-AE", {
  style: "currency",
  currency: "AED",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/** Formats integer fils as AED, e.g. 12550 -> "AED 125.50". */
export function formatAED(fils: number, opts: { whole?: boolean } = {}): string {
  if (!Number.isFinite(fils)) return "—";
  const value = fils / 100;
  return (opts.whole && fils % 100 === 0 ? aedWhole : aed).format(value);
}

/** Parses a user-entered AED amount ("125.5") into integer fils, or null if invalid. */
export function parseAEDToFils(input: string | null | undefined): number | null {
  if (input == null) return null;
  const trimmed = String(input).trim().replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const [whole, frac = ""] = trimmed.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

/** "Fri, 30 Oct 2026, 10:00" in the given IANA time zone. */
export function formatDateTime(date: Date | string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(date));
}

export function formatDate(date: Date | string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(date));
}

export function formatTime(date: Date | string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(date));
}

/** Short time-zone label such as "GST" or "GMT+4" for a zone at a given instant. */
export function timeZoneLabel(timeZone: string, at: Date = new Date()): string {
  const part = new Intl.DateTimeFormat("en-GB", { timeZone, timeZoneName: "short" })
    .formatToParts(at)
    .find((p) => p.type === "timeZoneName");
  return part?.value ?? timeZone;
}

export function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split(/[_\s]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function pluralize(n: number, singular: string, plural = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : plural}`;
}
