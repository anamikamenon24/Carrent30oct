import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { TripFields } from "@/components/trip-fields";
import { PageLoading } from "@/components/ui/states";
import { VehicleVisual } from "@/components/vehicle-visual";
import { formatAED, titleCase } from "@/lib/format";
import { defaultTrip } from "@/lib/search-params";
import { localDateKey } from "@/lib/tz";
import { getBranch, listBranches, listVehicles } from "@/server/data/catalog";
import { BranchHours } from "../branch-hours";

export async function generateMetadata({ params }: PageProps<"/branches/[code]">): Promise<Metadata> {
  const { code } = await params;
  const branch = await getBranch(code);
  return { title: branch ? branch.name : "Branch not found" };
}

export default function BranchPage({ params }: PageProps<"/branches/[code]">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <BranchContent params={params} />
    </Suspense>
  );
}

async function BranchContent({ params }: { params: PageProps<"/branches/[code]">["params"] }) {
  const { code } = await params;
  await connection();
  const branch = await getBranch(code);
  if (!branch || !branch.isActive) notFound();
  const [branches, fleet] = await Promise.all([
    listBranches(),
    listVehicles({ branchId: branch.id, status: ["AVAILABLE", "RESERVED", "ON_RENT"] }),
  ]);
  const todayKey = localDateKey(new Date(), branch.timeZone);
  const trip = defaultTrip(todayKey);
  const mapUrl =
    branch.latitude != null && branch.longitude != null
      ? `https://www.openstreetmap.org/?mlat=${branch.latitude}&mlon=${branch.longitude}#map=16/${branch.latitude}/${branch.longitude}`
      : null;

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">
      <nav className="text-sm text-muted" aria-label="Breadcrumb">
        <Link href="/branches" className="hover:text-ink">
          Branches
        </Link>{" "}
        / <span className="text-ink">{branch.name}</span>
      </nav>
      <div className="mt-4 grid gap-6 lg:grid-cols-[1fr_24rem]">
        <div className="min-w-0">
          <h1 className="text-3xl font-bold tracking-tight">{branch.name}</h1>
          <p className="mt-1 text-muted">
            {branch.addressLine}, {branch.city}, {branch.emirate}
          </p>
          <dl className="mt-6 grid gap-4 sm:grid-cols-3">
            <div className="card p-4">
              <dt className="text-xs font-semibold text-muted uppercase">Opening hours</dt>
              <dd className="mt-1 text-sm">
                <BranchHours branch={branch} />
              </dd>
            </div>
            <div className="card p-4">
              <dt className="text-xs font-semibold text-muted uppercase">Contact</dt>
              <dd className="mt-1 text-sm">
                {branch.phone ?? "—"}
                {branch.email && <span className="block truncate text-muted">{branch.email}</span>}
              </dd>
            </div>
            <div className="card p-4">
              <dt className="text-xs font-semibold text-muted uppercase">Branch code</dt>
              <dd className="mt-1 font-mono text-sm">{branch.code}</dd>
              {mapUrl && (
                <a href={mapUrl} target="_blank" rel="noopener noreferrer" className="mt-1 block text-sm text-brand-700 hover:underline">
                  Open map
                </a>
              )}
            </div>
          </dl>

          <h2 className="mt-10 text-xl font-semibold">Cars based here</h2>
          {fleet.length === 0 ? (
            <p className="mt-2 text-sm text-muted">No cars are based at this branch right now. Try a nearby branch.</p>
          ) : (
            <ul className="mt-4 grid gap-4 sm:grid-cols-2">
              {fleet.map((v) => (
                <li key={v.id} className="card flex overflow-hidden">
                  <div className="w-32 shrink-0">
                    <VehicleVisual photos={v.photos} color={v.color} alt={`${v.make} ${v.model}`} />
                  </div>
                  <div className="p-3">
                    <Link href={`/vehicles/${v.id}?pickup=${branch.code}`} className="font-semibold hover:text-brand-700">
                      {v.make} {v.model}
                    </Link>
                    <p className="text-xs text-muted">
                      {v.category.name} · {v.seats} seats · {titleCase(v.transmission)}
                    </p>
                    <p className="mt-1 text-sm font-semibold">{formatAED(v.dailyRateFils)} / day</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <aside className="card h-fit p-5 lg:sticky lg:top-20">
          <h2 className="mb-3 font-semibold">Rent from {branch.name}</h2>
          <Form action="/search" data-testid="search-form">
            <TripFields
              branches={branches.map((b) => ({ code: b.code, name: b.name, city: b.city }))}
              pickup={branch.code}
              start={trip.start}
              end={trip.end}
              minDate={todayKey}
              layout="stack"
            />
            <button type="submit" className="btn-primary mt-4 w-full" data-testid="search-submit">
              Search cars
            </button>
          </Form>
        </aside>
      </div>
    </div>
  );
}
