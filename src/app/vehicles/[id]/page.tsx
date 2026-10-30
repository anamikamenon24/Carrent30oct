import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { loadBookingContext } from "@/app/book/booking-context";
import { AvailabilityCalendar } from "@/components/availability-calendar";
import { TripFields } from "@/components/trip-fields";
import { Alert } from "@/components/ui/alert";
import { PageLoading } from "@/components/ui/states";
import { VehicleVisual } from "@/components/vehicle-visual";
import { formatAED, formatDateTime, titleCase } from "@/lib/format";
import { criteriaToQuery, tripQuery } from "@/lib/search-params";
import { addDaysToKey, localToUtc } from "@/lib/tz";
import { getVehicle } from "@/server/data/catalog";
import { getVehicleBusyIntervals } from "@/server/reservations/availability";

export async function generateMetadata({ params }: PageProps<"/vehicles/[id]">): Promise<Metadata> {
  const { id } = await params;
  const v = await getVehicle(id);
  return { title: v ? `${v.make} ${v.model}` : "Car not found" };
}

export default function VehiclePage({ params, searchParams }: PageProps<"/vehicles/[id]">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <VehicleContent params={params} searchParams={searchParams} />
    </Suspense>
  );
}

function firstOf(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

async function VehicleContent({
  params,
  searchParams,
}: {
  params: PageProps<"/vehicles/[id]">["params"];
  searchParams: PageProps<"/vehicles/[id]">["searchParams"];
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  await connection();
  const ctx = await loadBookingContext(id, sp);
  const { vehicle, pickupBranch, criteria, quote, problem } = ctx;

  // Calendar in the vehicle's branch time zone.
  const tz = vehicle.branch.timeZone;
  const monthParam = firstOf(sp.month);
  const month = monthParam && /^\d{4}-\d{2}$/.test(monthParam) ? monthParam : criteria.start.slice(0, 7);
  const monthStart = localToUtc(`${month}-01T00:00`, tz);
  const monthEnd = localToUtc(`${addDaysToKey(`${month}-01`, 40).slice(0, 7)}-01T00:00`, tz);
  const busy = await getVehicleBusyIntervals(vehicle.id, monthStart, monthEnd);
  const baseQuery = criteriaToQuery(criteria);
  const trip = tripQuery(criteria);
  const name = `${vehicle.make} ${vehicle.model}`;

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
      <nav className="text-sm text-muted" aria-label="Breadcrumb">
        <Link href={`/search?${baseQuery}`} className="hover:text-ink">
          ← Back to results
        </Link>
      </nav>
      <div className="mt-4 grid gap-8 lg:grid-cols-[1fr_24rem]">
        <div className="min-w-0 space-y-6">
          <div className="card overflow-hidden">
            <div className="aspect-[16/8]">
              <VehicleVisual photos={vehicle.photos} color={vehicle.color} alt={`${name} ${vehicle.year}`} />
            </div>
            {vehicle.photos.length > 1 && (
              <ul className="flex gap-2 overflow-x-auto p-3">
                {vehicle.photos.slice(1).map((p, i) => (
                  <li key={p} className="h-16 w-24 shrink-0 overflow-hidden rounded-md">
                    <VehicleVisual photos={[p]} alt={`${name} photo ${i + 2}`} />
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <p className="text-sm font-medium text-brand-700">{vehicle.category.name}</p>
            <h1 className="text-3xl font-bold tracking-tight" data-testid="vehicle-name">
              {name} <span className="text-xl font-normal text-muted">{vehicle.year}</span>
            </h1>
            {vehicle.description && <p className="mt-2 max-w-2xl text-muted">{vehicle.description}</p>}
          </div>

          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["Seats", String(vehicle.seats)],
              ["Transmission", titleCase(vehicle.transmission)],
              ["Fuel", titleCase(vehicle.fuelType)],
              ["Doors", String(vehicle.doors)],
              ["Luggage", `${vehicle.luggage} bags`],
              ["Colour", vehicle.color ?? "—"],
              ["Minimum driver age", `${vehicle.category.minDriverAge}+`],
              ["Security deposit", formatAED(vehicle.depositFils)],
            ].map(([k, val]) => (
              <div key={k} className="card p-3">
                <dt className="text-xs text-muted">{k}</dt>
                <dd className="mt-0.5 font-semibold">{val}</dd>
              </div>
            ))}
          </dl>

          {vehicle.features.length > 0 && (
            <section>
              <h2 className="text-lg font-semibold">Features</h2>
              <ul className="mt-2 flex flex-wrap gap-2">
                {vehicle.features.map((f) => (
                  <li key={f.id} className="badge bg-white py-1 text-sm ring-1 ring-line">
                    {f.name}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section aria-labelledby="avail-title">
            <h2 id="avail-title" className="text-lg font-semibold">
              Availability
            </h2>
            <p className="mb-3 text-sm text-muted">
              Based at {vehicle.branch.name}. Days are shown in {tz} time.
            </p>
            <div className="max-w-md">
              <AvailabilityCalendar
                month={month}
                todayKey={ctx.todayKey}
                busy={busy}
                timeZone={tz}
                monthHref={(m) => `/vehicles/${vehicle.id}?${baseQuery}&month=${m}`}
                selected={{ from: criteria.start.slice(0, 10), to: criteria.end.slice(0, 10) }}
              />
            </div>
          </section>
        </div>

        <aside className="lg:sticky lg:top-20 lg:self-start">
          <div className="card p-5">
            <p className="text-sm text-muted">From</p>
            <p className="text-3xl font-bold tabular-nums">
              {formatAED(quote?.averageDailyRateFils ?? vehicle.dailyRateFils)}
              <span className="text-base font-normal text-muted"> / day</span>
            </p>
            <div className="mt-4" data-testid="availability-status">
              {problem ? (
                <Alert tone="warning" testId="availability-problem">
                  {problem}
                </Alert>
              ) : (
                quote && (
                  <Alert tone="success" testId="availability-ok">
                    Available {formatDateTime(ctx.start, pickupBranch.timeZone)} → {formatDateTime(ctx.end, pickupBranch.timeZone)}.{" "}
                    {formatAED(quote.totalFils)} incl. VAT for {quote.days} {quote.days === 1 ? "day" : "days"}.
                  </Alert>
                )
              )}
            </div>
            <Form action={`/book/${vehicle.id}`} className="mt-4" key={trip}>
              <TripFields
                branches={ctx.branches.map((b) => ({ code: b.code, name: b.name, city: b.city }))}
                pickup={criteria.pickup}
                dropoff={criteria.dropoff === criteria.pickup ? undefined : criteria.dropoff}
                start={criteria.start}
                end={criteria.end}
                minDate={ctx.todayKey}
                layout="stack"
              />
              <button type="submit" className="btn-primary mt-4 w-full py-3" data-testid="choose-dates">
                Choose these dates
              </button>
            </Form>
          </div>
        </aside>
      </div>
    </div>
  );
}
