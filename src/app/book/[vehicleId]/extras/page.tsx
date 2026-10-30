import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { randomUUID } from "node:crypto";
import { Suspense } from "react";
import { BookingSteps } from "@/components/booking-steps";
import { ExtrasPicker } from "@/components/extras-picker";
import { PriceBreakdown } from "@/components/price-breakdown";
import { Alert } from "@/components/ui/alert";
import { PageLoading } from "@/components/ui/states";
import { quoteToLines } from "@/lib/price-lines";
import { tripQuery } from "@/lib/search-params";
import { getCurrentUser } from "@/server/session";
import { loadBookingContext } from "../../booking-context";
import { HoldForm } from "../../hold-form";
import { TripSummary } from "../../trip-summary";

export const metadata: Metadata = { title: "Choose extras" };

export default function ExtrasPage({ params, searchParams }: PageProps<"/book/[vehicleId]/extras">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <Extras params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Extras({
  params,
  searchParams,
}: {
  params: PageProps<"/book/[vehicleId]/extras">["params"];
  searchParams: PageProps<"/book/[vehicleId]/extras">["searchParams"];
}) {
  const [{ vehicleId }, sp] = await Promise.all([params, searchParams]);
  await connection();
  const [ctx, user] = await Promise.all([loadBookingContext(vehicleId, sp), getCurrentUser()]);
  const { vehicle, criteria, quote, problem, extras, selectedExtras } = ctx;
  const trip = tripQuery(criteria);
  const tripFields = { pickup: criteria.pickup, dropoff: criteria.dropoff, start: criteria.start, end: criteria.end };
  const selectedQuery = Object.entries(selectedExtras)
    .map(([code, q]) => `&extra=${encodeURIComponent(code)}&qty_${code}=${q}`)
    .join("");
  const here = `/book/${vehicle.id}/extras?${trip}${selectedQuery}`;

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
      <BookingSteps current={1} />
      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_22rem]">
        <section className="min-w-0">
          <h1 className="text-xl font-bold">Add extras</h1>
          <p className="mt-1 text-sm text-muted">Prices update as you choose. Per-day extras are charged for each rental day.</p>
          <div className="mt-4">
            {extras.length === 0 ? (
              <p className="card p-4 text-sm text-muted">No extras are offered right now.</p>
            ) : (
              <ExtrasPicker action={`/book/${vehicle.id}/extras`} hidden={tripFields} extras={extras} selected={selectedExtras} />
            )}
          </div>
          <Link href={`/book/${vehicle.id}?${trip}`} className="mt-4 inline-block text-sm font-medium text-brand-700 hover:underline">
            ← Back to dates
          </Link>
        </section>

        <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <TripSummary ctx={ctx} editHref={`/book/${vehicle.id}?${trip}`} />
          <div className="card p-4">
            {problem ? (
              <Alert tone="error" testId="availability-problem">
                {problem}
              </Alert>
            ) : (
              quote && (
                <div className="space-y-4">
                  <PriceBreakdown price={quoteToLines(quote)} />
                  <HoldForm
                    signedIn={Boolean(user)}
                    fields={{
                      ...tripFields,
                      vehicleId: vehicle.id,
                      idempotencyKey: randomUUID(),
                      returnTo: here,
                      ...Object.fromEntries(Object.entries(selectedExtras).map(([code, q]) => [`qty_${code}`, String(q)])),
                    }}
                  />
                </div>
              )
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
