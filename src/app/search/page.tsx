import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { TripFields } from "@/components/trip-fields";
import { Alert } from "@/components/ui/alert";
import { EmptyState, Skeleton } from "@/components/ui/states";
import { VehicleCard } from "@/components/vehicle-card";
import { formatDateTime, pluralize } from "@/lib/format";
import { criteriaToQuery, defaultTrip, parseCriteria, tripQuery, type SearchCriteria } from "@/lib/search-params";
import { localDateKey, localToUtc } from "@/lib/tz";
import { listBranches, listCategories } from "@/server/data/catalog";
import { searchVehicles } from "@/server/reservations/availability";
import { isReservationError } from "@/server/reservations/errors";
import { SearchFilters } from "./filters";

export const metadata: Metadata = { title: "Find a car" };

export default function SearchPage({ searchParams }: PageProps<"/search">) {
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
      <Suspense fallback={<SearchSkeleton />}>
        <SearchContent searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

function SearchSkeleton() {
  return (
    <div role="status" aria-label="Loading cars">
      <Skeleton className="h-32" />
      <div className="mt-6 grid gap-6 lg:grid-cols-[16rem_1fr]">
        <Skeleton className="hidden h-96 lg:block" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-80" />
          ))}
        </div>
      </div>
    </div>
  );
}

async function SearchContent({ searchParams }: { searchParams: PageProps<"/search">["searchParams"] }) {
  const sp = await searchParams;
  await connection();
  const parsed = parseCriteria(sp);
  const [branches, categories] = await Promise.all([listBranches(), listCategories()]);

  if (branches.length === 0) {
    return <EmptyState title="No branches are open yet" description="Please check back soon." />;
  }

  const pickupBranch = branches.find((b) => b.code === parsed.pickup) ?? branches[0];
  const returnBranch = branches.find((b) => b.code === parsed.dropoff) ?? pickupBranch;
  const todayKey = localDateKey(new Date(), pickupBranch.timeZone);
  const fallback = defaultTrip(todayKey);
  const criteria: SearchCriteria = {
    ...parsed,
    pickup: pickupBranch.code,
    dropoff: returnBranch.code,
    start: parsed.start ?? fallback.start,
    end: parsed.end ?? fallback.end,
  };
  const start = localToUtc(criteria.start!, pickupBranch.timeZone);
  const end = localToUtc(criteria.end!, pickupBranch.timeZone);
  const category = categories.find((c) => c.code === criteria.category);

  let results: Awaited<ReturnType<typeof searchVehicles>> = [];
  let error: string | null = null;
  if (end <= start) {
    error = "Return must be after pick-up. Please change your dates.";
  } else {
    try {
      results = await searchVehicles({
        pickupBranchId: pickupBranch.id,
        returnBranchId: returnBranch.id,
        start,
        end,
        categoryId: category?.id,
        transmission: criteria.transmission,
        minSeats: criteria.seats,
        fuel: criteria.fuel,
        minDailyFils: criteria.minPrice ? Math.round(criteria.minPrice * 100) : undefined,
        maxDailyFils: criteria.maxPrice ? Math.round(criteria.maxPrice * 100) : undefined,
        sort: criteria.sort === "-price" ? "price_desc" : "price_asc",
      });
    } catch (err) {
      if (!isReservationError(err)) throw err;
      error = err.message;
    }
  }

  const trip = tripQuery(criteria);
  const activeFilters = Boolean(criteria.category || criteria.transmission || criteria.seats || criteria.fuel || criteria.minPrice || criteria.maxPrice);

  return (
    <Form action="/search" key={criteriaToQuery(criteria)} data-testid="search-form">
      <section className="card p-4 sm:p-5" aria-label="Trip">
        <TripFields
          branches={branches.map((b) => ({ code: b.code, name: b.name, city: b.city }))}
          pickup={criteria.pickup}
          dropoff={criteria.dropoff === criteria.pickup ? undefined : criteria.dropoff}
          start={criteria.start!}
          end={criteria.end!}
          minDate={todayKey}
        />
        <div className="mt-4 flex flex-col-reverse items-stretch justify-between gap-3 sm:flex-row sm:items-center">
          <p className="text-xs text-muted">
            Times are local to {pickupBranch.name} ({pickupBranch.timeZone}).
          </p>
          <button type="submit" className="btn-primary px-8" data-testid="search-submit">
            Search
          </button>
        </div>
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-[16rem_1fr]">
        <aside className="lg:sticky lg:top-20 lg:self-start">
          <details className="card group p-4 lg:open:block" open={activeFilters}>
            <summary className="flex cursor-pointer items-center justify-between font-semibold lg:pointer-events-none lg:cursor-auto [&::-webkit-details-marker]:hidden">
              Filters
              <span className="text-sm font-normal text-muted lg:hidden">{activeFilters ? "Active" : "Show"}</span>
            </summary>
            <div className="mt-4">
              <SearchFilters
                criteria={criteria}
                categories={categories.map((c) => ({ code: c.code, name: c.name }))}
                seatOptions={[2, 4, 5, 7]}
              />
              <div className="mt-5 flex gap-2">
                <button type="submit" className="btn-primary flex-1" data-testid="apply-filters">
                  Apply
                </button>
                <Link href={`/search?${trip}`} className="btn-secondary" data-testid="clear-filters">
                  Clear
                </Link>
              </div>
            </div>
          </details>
        </aside>

        <section aria-labelledby="results-title" aria-live="polite">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
            <h1 id="results-title" className="text-xl font-bold" data-testid="results-count" data-count={results.length}>
              {error ? "Search" : `${pluralize(results.length, "car")} available`}
            </h1>
            <p className="text-sm text-muted">
              {formatDateTime(start, pickupBranch.timeZone)} → {formatDateTime(end, pickupBranch.timeZone)}
              {returnBranch.id !== pickupBranch.id && ` · return to ${returnBranch.name}`}
            </p>
          </div>
          {error ? (
            <Alert tone="error" testId="search-error">
              {error}
            </Alert>
          ) : results.length === 0 ? (
            <EmptyState
              title="No cars match"
              description={
                activeFilters
                  ? "Try removing some filters or changing your dates."
                  : "Every car at this branch is booked for these dates. Try different dates or another branch."
              }
              action={activeFilters ? { href: `/search?${trip}`, label: "Clear filters" } : undefined}
            />
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {results.map((v) => (
                <li key={v.id}>
                  <VehicleCard
                    href={`/vehicles/${v.id}?${trip}`}
                    v={{
                      id: v.id,
                      make: v.make,
                      model: v.model,
                      year: v.year,
                      color: v.color,
                      transmission: v.transmission,
                      fuelType: v.fuelType,
                      seats: v.seats,
                      doors: v.doors,
                      luggage: v.luggage,
                      photos: v.photos,
                      categoryName: v.category.name,
                      dailyRateFils: v.quote.averageDailyRateFils,
                      rentalFils: v.quote.rentalFils - v.quote.discountFils + v.quote.oneWayFeeFils,
                      rentalDays: v.quote.days,
                    }}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Form>
  );
}
