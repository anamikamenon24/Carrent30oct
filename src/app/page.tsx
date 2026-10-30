import Form from "next/form";
import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { TripFields } from "@/components/trip-fields";
import { Skeleton } from "@/components/ui/states";
import { formatAED } from "@/lib/format";
import { defaultTrip } from "@/lib/search-params";
import { localDateKey } from "@/lib/tz";
import { listBranches, listCategories } from "@/server/data/catalog";

export default function HomePage() {
  return (
    <>
      <section className="relative overflow-hidden bg-brand-950 text-white">
        <div
          className="absolute inset-0 opacity-30"
          style={{
            backgroundImage:
              "radial-gradient(circle at 20% 20%, #249e8e 0, transparent 40%), radial-gradient(circle at 85% 70%, #c48f5a 0, transparent 35%)",
          }}
          aria-hidden
        />
        <div className="relative mx-auto max-w-7xl px-4 pt-14 pb-28 sm:px-6 lg:pt-20">
          <p className="text-sm font-semibold tracking-wide text-brand-300 uppercase">Car rental across the UAE</p>
          <h1 className="mt-3 max-w-2xl text-4xl font-bold tracking-tight sm:text-5xl">
            The right car, the honest price.
          </h1>
          <p className="mt-4 max-w-xl text-lg text-brand-100">
            Pick up in one city, return in another. Daily rate, extras, one-way fee, VAT and deposit are all shown
            before you pay.
          </p>
        </div>
      </section>

      <div className="relative mx-auto -mt-20 w-full max-w-7xl px-4 sm:px-6">
        <div className="card p-4 shadow-lg sm:p-6">
          <h2 className="mb-4 text-lg font-semibold">Find your car</h2>
          <Suspense fallback={<SearchSkeleton />}>
            <HomeSearch />
          </Suspense>
        </div>
      </div>

      <section className="mx-auto mt-16 w-full max-w-7xl px-4 sm:px-6" aria-labelledby="why">
        <h2 id="why" className="sr-only">
          Why DriveEasy
        </h2>
        <ul className="grid gap-4 sm:grid-cols-3">
          {[
            ["Transparent pricing", "Every fee itemised in AED, with 5% VAT shown on its own line."],
            ["Flexible changes", "Change dates or cancel from My rentals. Free cancellation up to 48 hours before pick-up."],
            ["Digital voucher", "Show the QR code at the counter and drive away. No paperwork queue."],
          ].map(([title, text]) => (
            <li key={title} className="card p-5">
              <h3 className="font-semibold">{title}</h3>
              <p className="mt-1 text-sm text-muted">{text}</p>
            </li>
          ))}
        </ul>
      </section>

      <Suspense fallback={null}>
        <CategoryStrip />
      </Suspense>
    </>
  );
}

function SearchSkeleton() {
  return (
    <div className="space-y-3" aria-hidden>
      <div className="grid gap-3 sm:grid-cols-2">
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
      </div>
    </div>
  );
}

async function HomeSearch() {
  await connection();
  const branches = await listBranches();
  if (branches.length === 0) {
    return <p className="text-sm text-muted">No branches are open for bookings yet. Please check back soon.</p>;
  }
  const todayKey = localDateKey(new Date(), branches[0].timeZone);
  const trip = defaultTrip(todayKey);
  return (
    <Form action="/search" data-testid="search-form">
      <TripFields
        branches={branches.map((b) => ({ code: b.code, name: b.name, city: b.city }))}
        pickup={branches[0].code}
        start={trip.start}
        end={trip.end}
        minDate={todayKey}
      />
      <div className="mt-4 flex justify-end">
        <button type="submit" className="btn-primary w-full px-8 py-3 text-base sm:w-auto" data-testid="search-submit">
          Search cars
        </button>
      </div>
    </Form>
  );
}

async function CategoryStrip() {
  const categories = await listCategories();
  if (categories.length === 0) return null;
  return (
    <section className="mx-auto mt-16 w-full max-w-7xl px-4 sm:px-6" aria-labelledby="cats">
      <div className="flex items-end justify-between">
        <h2 id="cats" className="text-2xl font-bold tracking-tight">
          Browse by category
        </h2>
        <Link href="/search" className="text-sm font-medium text-brand-700 hover:underline">
          See all cars
        </Link>
      </div>
      <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {categories.map((c) => (
          <li key={c.id}>
            <Link href={`/search?category=${encodeURIComponent(c.code)}`} className="card block p-5 transition-shadow hover:shadow-md">
              <p className="font-semibold">{c.name}</p>
              {c.description && <p className="mt-1 line-clamp-2 text-sm text-muted">{c.description}</p>}
              <p className="mt-3 text-sm">
                from <span className="font-semibold">{formatAED(c.dailyRateFils, { whole: true })}</span>
                <span className="text-muted"> / day</span>
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
