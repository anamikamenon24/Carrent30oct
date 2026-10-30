import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { VehicleForm } from "@/components/admin-forms";
import { AvailabilityCalendar } from "@/components/availability-calendar";
import { ActionForm } from "@/components/rental-actions";
import { Alert } from "@/components/ui/alert";
import { Field } from "@/components/ui/field";
import { PageLoading, StatusBadge } from "@/components/ui/states";
import { SubmitButton } from "@/components/ui/submit-button";
import { VehicleVisual } from "@/components/vehicle-visual";
import { formatDateTime } from "@/lib/format";
import { addDaysToKey, localDateKey, localToUtc } from "@/lib/tz";
import { listMaintenanceBlocks } from "@/server/data/admin";
import { getVehicle, listBranches, listCategories, listFeatures } from "@/server/data/catalog";
import { getVehicleBusyIntervals } from "@/server/reservations/availability";
import { listReservations } from "@/server/reservations/queries";
import { requireAdmin } from "@/server/session";
import { createMaintenanceAction, deleteMaintenanceAction, removeVehiclePhotoAction, updateVehicleAction } from "../../actions";

export const metadata: Metadata = { title: "Vehicle · Admin" };

export default function VehicleAdminPage({ params, searchParams }: PageProps<"/admin/fleet/[id]">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <VehicleAdmin params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function VehicleAdmin({ params, searchParams }: { params: PageProps<"/admin/fleet/[id]">["params"]; searchParams: PageProps<"/admin/fleet/[id]">["searchParams"] }) {
  await requireAdmin();
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  await connection();
  const v = await getVehicle(id);
  if (!v) notFound();
  const tz = v.branch.timeZone;
  const todayKey = localDateKey(new Date(), tz);
  const month = typeof sp.month === "string" && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : todayKey.slice(0, 7);
  const now = new Date();
  const [branches, categories, features, blocks, busy, upcoming] = await Promise.all([
    listBranches({ includeInactive: true }),
    listCategories(),
    listFeatures(),
    listMaintenanceBlocks({ vehicleId: v.id, from: now }),
    getVehicleBusyIntervals(v.id, localToUtc(`${month}-01T00:00`, tz), localToUtc(`${addDaysToKey(`${month}-01`, 40).slice(0, 7)}-01T00:00`, tz)),
    listReservations({ vehicleId: v.id, status: ["PENDING", "CONFIRMED", "PICKED_UP"], from: now, limit: 20 }),
  ]);

  return (
    <div className="space-y-6">
      <Link href="/admin/fleet" className="text-sm text-muted hover:text-ink">
        ← Fleet
      </Link>
      {typeof sp.saved === "string" && <Alert tone="success">Vehicle saved.</Alert>}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">
          {v.make} {v.model} <span className="font-mono text-lg text-muted">{v.plateNumber}</span>
        </h1>
        <StatusBadge status={v.status} testId="vehicle-status-badge" />
      </div>

      <section className="card p-5">
        <h2 className="mb-4 text-lg font-semibold">Details</h2>
        <VehicleForm
          action={updateVehicleAction}
          initial={{
            id: v.id,
            categoryId: v.category.id,
            branchId: v.branchId,
            plateNumber: v.plateNumber,
            vin: v.vin,
            make: v.make,
            model: v.model,
            year: v.year,
            color: v.color,
            transmission: v.transmission,
            fuelType: v.fuelType,
            seats: v.seats,
            doors: v.doors,
            luggage: v.luggage,
            mileageKm: v.mileageKm,
            dailyRateFils: v.dailyRateFils === undefined ? null : v.dailyRateFils,
            status: v.status,
            description: v.description,
            featureIds: v.features.map((f) => f.id),
          }}
          categories={categories.map((c) => ({ id: c.id, name: c.name }))}
          branches={branches.map((b) => ({ id: b.id, name: b.name }))}
          features={features.map((f) => ({ id: f.id, name: f.name }))}
          submitLabel="Save vehicle"
        />
        {v.photos.length > 0 && (
          <div className="mt-6">
            <h3 className="mb-2 text-sm font-semibold">Photos</h3>
            <ul className="flex flex-wrap gap-3">
              {v.photos.map((p, i) => (
                <li key={p} className="w-36 overflow-hidden rounded-lg border border-line">
                  <div className="h-24">
                    <VehicleVisual photos={[p]} alt={`Photo ${i + 1}`} />
                  </div>
                  <ActionForm action={removeVehiclePhotoAction} className="p-1">
                    <input type="hidden" name="id" value={v.id} />
                    <input type="hidden" name="photo" value={p} />
                    <SubmitButton className="btn-ghost w-full py-1 text-xs text-red-700" pendingText="Removing…">
                      Remove
                    </SubmitButton>
                  </ActionForm>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Availability</h2>
          <AvailabilityCalendar month={month} todayKey={todayKey} busy={busy} timeZone={tz} monthHref={(m) => `/admin/fleet/${v.id}?month=${m}`} />
          <div className="card p-4">
            <h3 className="mb-2 font-semibold">Upcoming bookings</h3>
            {upcoming.length === 0 ? (
              <p className="text-sm text-muted">None.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {upcoming.map(({ reservation: r, pickupBranch: pb }) => (
                  <li key={r.id}>
                    <Link href={`/admin/reservations/${r.id}`} className="font-mono text-brand-700 hover:underline">
                      {r.reference}
                    </Link>{" "}
                    {formatDateTime(r.pickupAt, pb.timeZone)} → {formatDateTime(r.returnAt, pb.timeZone)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section className="card p-5" aria-labelledby="mb-h">
          <h2 id="mb-h" className="text-lg font-semibold">
            Maintenance
          </h2>
          <p className="mb-3 text-sm text-muted">Block the car for servicing. Blocks can&rsquo;t overlap bookings. Times in {tz}.</p>
          {blocks.length > 0 && (
            <ul className="mb-4 space-y-2">
              {blocks.map(({ block: b }) => (
                <li key={b.id} className="flex items-center justify-between gap-2 rounded-lg border border-line p-2 text-sm" data-testid="maintenance-block">
                  <span>
                    {formatDateTime(b.startsAt, tz)} → {formatDateTime(b.endsAt, tz)}
                    <span className="block text-muted">{b.reason}</span>
                  </span>
                  <ActionForm action={deleteMaintenanceAction}>
                    <input type="hidden" name="id" value={b.id} />
                    <input type="hidden" name="vehicleId" value={v.id} />
                    <SubmitButton className="btn-ghost text-red-700" pendingText="…">
                      Remove
                    </SubmitButton>
                  </ActionForm>
                </li>
              ))}
            </ul>
          )}
          <ActionForm action={createMaintenanceAction} className="grid gap-3 sm:grid-cols-2" testId="maintenance-form">
            <input type="hidden" name="vehicleId" value={v.id} />
            <Field label="Starts" name="startsAt" type="datetime-local" required />
            <Field label="Ends" name="endsAt" type="datetime-local" required />
            <Field label="Reason" name="reason" required className="sm:col-span-2" placeholder="e.g. 20,000 km service" />
            <div>
              <SubmitButton className="btn-secondary" pendingText="Adding…" testId="maintenance-submit">
                Add maintenance block
              </SubmitButton>
            </div>
          </ActionForm>
        </section>
      </div>
    </div>
  );
}
