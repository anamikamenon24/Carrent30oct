/**
 * Time-zone helpers. Timestamps are stored in UTC; users pick wall-clock times in the
 * pick-up branch's local zone. These convert between the two without external libraries.
 */

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

function partsInZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour") % 24,
    minute: get("minute"),
    second: get("second"),
  };
}

/** Offset of `timeZone` from UTC at `date`, in minutes (e.g. +240 for Asia/Dubai). */
export function zoneOffsetMinutes(date: Date, timeZone: string): number {
  const p = partsInZone(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

/** True when `value` looks like "YYYY-MM-DDTHH:mm". */
export function isLocalDateTime(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = LOCAL_RE.exec(value);
  if (!m) return false;
  const [, y, mo, d, h, mi] = m.map(Number);
  const probe = new Date(Date.UTC(y, mo - 1, d, h, mi));
  return probe.getUTCMonth() === mo - 1 && probe.getUTCDate() === d && h < 24 && mi < 60;
}

/** Converts a wall-clock time ("2026-11-02T10:00") in `timeZone` into a UTC Date. */
export function localToUtc(local: string, timeZone: string): Date {
  const m = LOCAL_RE.exec(local);
  if (!m) throw new Error(`Invalid local date-time: ${local}`);
  const [, y, mo, d, h, mi] = m.map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  let offset = zoneOffsetMinutes(new Date(guess), timeZone);
  let result = guess - offset * 60000;
  // Second pass handles DST transitions.
  const offset2 = zoneOffsetMinutes(new Date(result), timeZone);
  if (offset2 !== offset) {
    offset = offset2;
    result = guess - offset * 60000;
  }
  return new Date(result);
}

/** Formats a UTC Date as "YYYY-MM-DDTHH:mm" wall-clock time in `timeZone`. */
export function utcToLocal(date: Date, timeZone: string): string {
  const p = partsInZone(date, timeZone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** "YYYY-MM-DD" for `date` in `timeZone`. */
export function localDateKey(date: Date, timeZone: string): string {
  return utcToLocal(date, timeZone).slice(0, 10);
}

export function splitLocal(local: string): { date: string; time: string } {
  return { date: local.slice(0, 10), time: local.slice(11, 16) };
}

/** Adds whole days to a "YYYY-MM-DD" key. */
export function addDaysToKey(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}
