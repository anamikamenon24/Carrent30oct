import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AvailabilityCalendar } from "@/components/availability-calendar";
import { BookingSteps } from "@/components/booking-steps";
import { PriceBreakdown } from "@/components/price-breakdown";
import { TripFields } from "@/components/trip-fields";
import { Alert } from "@/components/ui/alert";
import { PageLoading } from "@/components/ui/states";
import { quoteToLines } from "@/lib/price-lines";
import { criteriaToQuery, tripQuery } from "@/lib/search-params";
import { addDaysToKey, localToUtc } from "@/lib/tz";
import { getVehicleBusyIntervals } from "@/server/reservations/availability";
import { loadBookingContext } from "../booking-context";
import { TripSummary } from "../trip-summary";

export const metadata: Metadata = { title: "Choose dates" };

export default function ChooseDatesPage({ params, searchParams }: PageProps<"/book/[vehicleId]">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <ChooseDates params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function ChooseDates({
  params,
  searchParams,
}: {
  params: PageProps<"/book/[vehicleId]">["params"];
  searchParams: PageProps<"/book/[vehicleId]">["searchParams"];
}) {
  const [{ vehicleId }, sp] = await Promise.all([params, searchParams]);
  await connection();
  const ctx = await loadBookingContext(vehicleId, sp);
  const { vehicle, criteria, quote, problem } = ctx;
  const tz = vehicle.branch.timeZone;
  const month = typeof sp.month === "string" && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : criteria.start.slice(0, 7);
  const busy = await getVehicleBusyIntervals(
    vehicle.id,
    localToUtc(`${month}-01T00:00`, tz),
    localToUtc(`${addDaysToKey(`${month}-01`, 40).slice(0, 7)}-01T00:00`, tz),
  );
  const trip = tripQuery(criteria);

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
      <BookingSteps current={0} />
      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="min-w-0 space-y-6">
          <section className="card p-5">
            <h1 className="text-xl font-bold">Choose your dates and branches</h1>
            <p className="mt-1 text-sm text-muted">Times are local to the pick-up branch ({ctx.pickupBranch.timeZone}).</p>
            <Form action={`/book/${vehicle.id}`} className="mt-4" key={trip} data-testid="dates-form">
              <TripFields
                branches={ctx.branches.map((b) => ({ code: b.code, name: b.name, city: b.city }))}
                pickup={criteria.pickup}
                dropoff={criteria.dropoff === criteria.pickup ? undefined : criteria.dropoff}
                start={criteria.start}
                end={criteria.end}
                minDate={ctx.todayKey}
              />
              <button type="submit" className="btn-secondary mt-4" data-testid="check-availability">
                Check availability
              </button>
            </Form>
          </section>

          <div className="max-w-md">
            <AvailabilityCalendar
              month={month}
              todayKey={ctx.todayKey}
              busy={busy}
              timeZone={tz}
              monthHref={(m) => `/book/${vehicle.id}?${criteriaToQuery(criteria)}&month=${m}`}
              selected={{ from: criteria.start.slice(0, 10), to: criteria.end.slice(0, 10) }}
            />
          </div>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <TripSummary ctx={ctx} />
          <div className="card p-4">
            {problem ? (
              <Alert tone="error" testId="availability-problem">
                {problem}
              </Alert>
            ) : quote ? (
              <>
                <PriceBreakdown price={quoteToLines(quote)} title="Price for these dates" />
                <Link href={`/book/${vehicle.id}/extras?${trip}`} className="btn-primary mt-4 w-full py-3" data-testid="continue-to-extras">
                  Continue to extras
                </Link>
              </>
            ) : null}
          </div>
        </aside>
      </div>
    </div>
  );
}
