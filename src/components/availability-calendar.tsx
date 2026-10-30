import Link from "next/link";
import { addDaysToKey, localToUtc } from "@/lib/tz";

export interface BusyInterval {
  start: Date;
  end: Date;
}

type DayStatus = "available" | "partial" | "booked" | "past";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

function dayStatus(key: string, todayKey: string, busy: BusyInterval[], timeZone: string): DayStatus {
  if (key < todayKey) return "past";
  const dayStart = localToUtc(`${key}T00:00`, timeZone).getTime();
  const dayEnd = localToUtc(`${addDaysToKey(key, 1)}T00:00`, timeZone).getTime();
  // Merge the parts of busy intervals that fall within this day.
  const pieces = busy
    .map((b) => [Math.max(dayStart, b.start.getTime()), Math.min(dayEnd, b.end.getTime())] as const)
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0]);
  if (pieces.length === 0) return "available";
  let covered = 0;
  let cursor = dayStart;
  for (const [s, e] of pieces) {
    const from = Math.max(s, cursor);
    if (e > from) {
      covered += e - from;
      cursor = e;
    }
  }
  return covered >= dayEnd - dayStart ? "booked" : "partial";
}

const STYLES: Record<DayStatus, string> = {
  available: "bg-emerald-50 text-emerald-900 border-emerald-200",
  partial: "bg-amber-50 text-amber-900 border-amber-200",
  booked: "bg-red-50 text-red-800 border-red-200 line-through decoration-red-300",
  past: "bg-transparent text-muted/50 border-transparent",
};

/**
 * Month grid showing when a vehicle is free, in the branch's local time zone.
 * `monthHref(month)` builds the link for the previous/next month buttons.
 */
export function AvailabilityCalendar({
  month,
  todayKey,
  busy,
  timeZone,
  monthHref,
  selected,
}: {
  month: string; // YYYY-MM
  todayKey: string; // YYYY-MM-DD in branch zone
  busy: BusyInterval[];
  timeZone: string;
  monthHref: (month: string) => string;
  selected?: { from: string; to: string }; // date keys
}) {
  const [y, m] = month.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const leading = (first.getUTCDay() + 6) % 7; // Monday-first
  const title = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(first);
  const canGoBack = month > todayKey.slice(0, 7);

  const cells: (string | null)[] = [
    ...Array.from({ length: leading }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`),
  ];

  return (
    <div className="card p-4" data-testid="availability-calendar" data-month={month}>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-semibold">{title}</h3>
        <div className="flex gap-1">
          {canGoBack ? (
            <Link href={monthHref(shiftMonth(month, -1))} scroll={false} className="btn-ghost px-2 py-1" aria-label="Previous month" data-testid="calendar-prev">
              ‹
            </Link>
          ) : (
            <span className="btn-ghost px-2 py-1 opacity-30" aria-hidden>
              ‹
            </span>
          )}
          <Link href={monthHref(shiftMonth(month, 1))} scroll={false} className="btn-ghost px-2 py-1" aria-label="Next month" data-testid="calendar-next">
            ›
          </Link>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-xs" role="grid" aria-label={`Availability for ${title}`}>
        {WEEKDAYS.map((d) => (
          <div key={d} className="py-1 font-medium text-muted" role="columnheader">
            {d}
          </div>
        ))}
        {cells.map((key, i) => {
          if (!key) return <div key={`e${i}`} />;
          const status = dayStatus(key, todayKey, busy, timeZone);
          const inSel = selected && key >= selected.from && key <= selected.to;
          return (
            <div
              key={key}
              role="gridcell"
              data-testid="calendar-day"
              data-date={key}
              data-status={status}
              aria-label={`${key}: ${status === "partial" ? "partly booked" : status}`}
              className={`rounded-md border py-2 tabular-nums ${STYLES[status]} ${inSel ? "ring-2 ring-brand-500" : ""}`}
            >
              {Number(key.slice(8))}
            </div>
          );
        })}
      </div>
      <ul className="mt-3 flex flex-wrap gap-3 text-xs text-muted">
        <li className="flex items-center gap-1">
          <span className="size-3 rounded-sm border border-emerald-200 bg-emerald-50" /> Available
        </li>
        <li className="flex items-center gap-1">
          <span className="size-3 rounded-sm border border-amber-200 bg-amber-50" /> Partly booked
        </li>
        <li className="flex items-center gap-1">
          <span className="size-3 rounded-sm border border-red-200 bg-red-50" /> Booked
        </li>
        {selected && (
          <li className="flex items-center gap-1">
            <span className="size-3 rounded-sm ring-2 ring-brand-500" /> Your dates
          </li>
        )}
      </ul>
    </div>
  );
}
