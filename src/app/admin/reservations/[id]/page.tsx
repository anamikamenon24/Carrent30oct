/* eslint-disable @next/next/no-img-element -- private, admin-only image routes */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { FuelSelect } from "@/components/admin-forms";
import { DamageForm } from "@/components/damage-form";
import { PaymentsTable } from "@/components/payments-table";
import { PriceBreakdown } from "@/components/price-breakdown";
import { ActionForm } from "@/components/rental-actions";
import { ReservationSummary } from "@/components/reservation-summary";
import { Field, SelectField } from "@/components/ui/field";
import { PageLoading, StatusBadge } from "@/components/ui/states";
import { SubmitButton } from "@/components/ui/submit-button";
import { formatAED, formatDate, formatDateTime, titleCase } from "@/lib/format";
import { reservationToLines } from "@/lib/price-lines";
import { listBranches } from "@/server/data/catalog";
import { getReservationDetail } from "@/server/reservations/queries";
import { requireAdmin } from "@/server/session";
import { adminCancelAction, checkInAction, checkOutAction, createDamageAction, verifyLicenceAction } from "../../actions";

export const metadata: Metadata = { title: "Reservation · Admin" };

export default function AdminReservationPage({ params }: PageProps<"/admin/reservations/[id]">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <Detail params={params} />
    </Suspense>
  );
}

async function Detail({ params }: { params: PageProps<"/admin/reservations/[id]">["params"] }) {
  await requireAdmin();
  const { id } = await params;
  await connection();
  const d = await getReservationDetail(id);
  if (!d) notFound();
  const r = d.reservation;
  const tz = d.pickupBranch.timeZone;
  const branches = r.status === "PICKED_UP" ? await listBranches() : [];
  const ag = d.agreement;

  return (
    <div className="space-y-6">
      <nav className="text-sm text-muted" aria-label="Breadcrumb">
        <Link href="/admin/reservations" className="hover:text-ink">
          Reservations
        </Link>{" "}
        / <span className="text-ink">{r.reference}</span>
      </nav>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-mono text-2xl font-bold">{r.reference}</h1>
        <StatusBadge status={r.status} testId="admin-reservation-status" />
        <span className="text-sm text-muted">
          {d.customer.name} · {d.customer.email}
        </span>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_22rem]">
        <div className="min-w-0 space-y-6">
          <ReservationSummary d={d} showImage={false} />

          <section className="card p-5" aria-labelledby="driver-h">
            <h2 id="driver-h" className="mb-3 text-lg font-semibold">
              Driver
            </h2>
            {d.driverProfile ? (
              <div className="flex flex-wrap items-start justify-between gap-4 text-sm">
                <div>
                  <p className="font-medium">
                    {d.driverProfile.firstName} {d.driverProfile.lastName}
                  </p>
                  <p className="text-muted">
                    Licence {d.driverProfile.licenceNumber}, expires {formatDate(`${d.driverProfile.licenceExpiresOn}T00:00:00Z`, "UTC")}
                  </p>
                  <a href={`/api/files/licence/${d.driverProfile.id}`} target="_blank" rel="noopener" className="mt-1 inline-block font-medium text-brand-700 hover:underline" data-testid="admin-licence-link">
                    Open licence file
                  </a>
                </div>
                {d.driverProfile.licenceVerifiedAt ? (
                  <span className="badge bg-emerald-100 text-emerald-900">Licence checked {formatDate(d.driverProfile.licenceVerifiedAt, tz)}</span>
                ) : (
                  <ActionForm action={verifyLicenceAction}>
                    <input type="hidden" name="profileId" value={d.driverProfile.id} />
                    <input type="hidden" name="reservationId" value={r.id} />
                    <SubmitButton className="btn-secondary" pendingText="Saving…" testId="verify-licence">
                      Mark licence as checked
                    </SubmitButton>
                  </ActionForm>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted">No driver details yet (the customer adds them at checkout).</p>
            )}
          </section>

          {r.status === "CONFIRMED" && (
            <section className="card p-5" aria-labelledby="co-h">
              <h2 id="co-h" className="text-lg font-semibold">
                Check-out (hand over the car)
              </h2>
              <p className="mb-4 text-sm text-muted">
                Booked pick-up {formatDateTime(r.pickupAt, tz)} at {d.pickupBranch.name}. Record the odometer and fuel as the customer drives away.
              </p>
              <ActionForm action={checkOutAction} className="grid gap-4 sm:grid-cols-3" testId="checkout-form">
                <input type="hidden" name="reservationId" value={r.id} />
                <Field label="Odometer (km)" name="mileageKm" type="number" min={0} required testId="checkout-mileage" />
                <FuelSelect />
                <Field label="Notes" name="notes" placeholder="Scratches noted, etc." />
                <div className="sm:col-span-3">
                  <SubmitButton pendingText="Checking out…" testId="checkout-submit">
                    Check out car
                  </SubmitButton>
                </div>
              </ActionForm>
            </section>
          )}

          {r.status === "PICKED_UP" && ag && (
            <section className="card p-5" aria-labelledby="ci-h">
              <h2 id="ci-h" className="text-lg font-semibold">
                Check-in (car returned)
              </h2>
              <p className="mb-4 text-sm text-muted">
                Checked out {formatDateTime(ag.checkedOutAt, tz)} with {ag.pickupMileageKm.toLocaleString("en")} km and fuel {ag.pickupFuelEighths}/8. Due back{" "}
                {formatDateTime(r.returnAt, d.returnBranch.timeZone)} at {d.returnBranch.name}. Late returns, missing fuel and charged damage are billed against the
                deposit automatically.
              </p>
              <ActionForm action={checkInAction} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" testId="checkin-form">
                <input type="hidden" name="reservationId" value={r.id} />
                <Field label="Odometer (km)" name="mileageKm" type="number" required hint={`At least ${ag.pickupMileageKm.toLocaleString("en")} km (reading at check-out).`} testId="checkin-mileage" />
                <FuelSelect />
                <SelectField label="Returned at" name="returnBranchId" defaultValue={r.returnBranchId}>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </SelectField>
                <Field label="Notes" name="notes" />
                <div className="sm:col-span-2 lg:col-span-4">
                  <SubmitButton pendingText="Checking in…" testId="checkin-submit">
                    Check in car
                  </SubmitButton>
                </div>
              </ActionForm>
            </section>
          )}

          {ag && (
            <section className="card p-5 text-sm" aria-labelledby="ag-h">
              <h2 id="ag-h" className="mb-3 text-lg font-semibold">
                Rental agreement {ag.agreementNumber}
              </h2>
              <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Item k="Checked out" v={`${formatDateTime(ag.checkedOutAt, tz)} · ${ag.pickupMileageKm.toLocaleString("en")} km · fuel ${ag.pickupFuelEighths}/8`} />
                {ag.returnedAt && (
                  <Item
                    k="Returned"
                    v={`${formatDateTime(ag.returnedAt, d.returnBranch.timeZone)} · ${ag.returnMileageKm?.toLocaleString("en")} km · fuel ${ag.returnFuelEighths}/8`}
                  />
                )}
                {ag.lateMinutes != null && ag.lateMinutes > 0 && <Item k="Late" v={`${ag.lateMinutes} min · ${formatAED(ag.lateFeeFils ?? 0)}`} />}
                {(ag.fuelChargeFils ?? 0) > 0 && <Item k="Fuel charge" v={formatAED(ag.fuelChargeFils ?? 0)} />}
                {(ag.damageChargeFils ?? 0) > 0 && <Item k="Damage charge" v={formatAED(ag.damageChargeFils ?? 0)} />}
                {ag.returnChargesFils != null && <Item k="Return charges incl. VAT" v={formatAED(ag.returnChargesFils)} testId="return-charges" fils={ag.returnChargesFils} />}
                {(ag.outstandingFils ?? 0) > 0 && <Item k="To collect at counter" v={formatAED(ag.outstandingFils ?? 0)} />}
                {ag.pickupNotes && <Item k="Pick-up notes" v={ag.pickupNotes} />}
                {ag.returnNotes && <Item k="Return notes" v={ag.returnNotes} />}
              </dl>
            </section>
          )}

          <section className="card p-5" aria-labelledby="dmg-h">
            <h2 id="dmg-h" className="mb-3 text-lg font-semibold">
              Damage
            </h2>
            {d.damageReports.length > 0 && (
              <ul className="mb-5 space-y-3">
                {d.damageReports.map((rep) => (
                  <li key={rep.id} className="rounded-lg border border-line p-3 text-sm" data-testid="damage-report">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="badge bg-orange-100 text-orange-900">{titleCase(rep.severity)}</span>
                      <span className="text-muted">{titleCase(rep.stage)}</span>
                      <span className="text-muted">· {titleCase(rep.status)}</span>
                      {rep.chargeFils > 0 && <span className="font-medium">Charge {formatAED(rep.chargeFils)}</span>}
                    </div>
                    <p className="mt-1">
                      {rep.location && <strong>{rep.location}: </strong>}
                      {rep.description}
                    </p>
                    {rep.photoKeys.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {rep.photoKeys.map((_, i) => (
                          <a key={i} href={`/api/files/damage/${rep.id}/${i}`} target="_blank" rel="noopener">
                            <img src={`/api/files/damage/${rep.id}/${i}`} alt={`Damage photo ${i + 1}`} className="size-20 rounded-md border border-line object-cover" />
                          </a>
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <DamageForm
              action={createDamageAction}
              vehicleId={r.vehicleId}
              reservationId={r.id}
              defaultStage={r.status === "PICKED_UP" ? "RETURN" : r.status === "CONFIRMED" ? "PICKUP" : "OTHER"}
              allowCharge={r.status === "PICKED_UP"}
            />
          </section>

          <section className="card p-5" aria-labelledby="pay-h">
            <h2 id="pay-h" className="mb-3 text-lg font-semibold">
              Payments and deposit
            </h2>
            <PaymentsTable payments={d.payments} deposits={d.deposits} timeZone={tz} />
          </section>
        </div>

        <aside className="space-y-4 xl:sticky xl:top-20 xl:self-start">
          <div className="card p-4">
            <PriceBreakdown price={reservationToLines(r, d.extras)} />
          </div>
          {(r.status === "PENDING" || r.status === "CONFIRMED") && (
            <div className="card p-4">
              <h2 className="font-semibold">Cancel reservation</h2>
              <p className="mt-1 text-sm text-muted">
                Policy fee if cancelled now: {formatAED(d.cancellation.feeFils)}
                {!d.cancellation.allowed && d.cancellation.reason ? ` (${d.cancellation.reason}; staff can still cancel with the fee waived)` : ""}.
              </p>
              <ActionForm action={adminCancelAction} className="mt-3 space-y-3" testId="admin-cancel-form">
                <input type="hidden" name="reservationId" value={r.id} />
                <Field label="Reason" name="reason" required placeholder="e.g. Customer called the branch" />
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="waiveFee" className="size-4 accent-brand-600" /> Waive the cancellation fee
                </label>
                <SubmitButton className="btn-danger" pendingText="Cancelling…" testId="admin-cancel-submit">
                  Cancel reservation
                </SubmitButton>
              </ActionForm>
            </div>
          )}
          {(r.status === "CONFIRMED" || r.status === "PICKED_UP") && (
            <Link href={`/rentals/${r.id}/voucher`} className="btn-secondary w-full">
              Open voucher
            </Link>
          )}
        </aside>
      </div>
    </div>
  );
}

function Item({ k, v, testId, fils }: { k: string; v: string; testId?: string; fils?: number }) {
  return (
    <div data-testid={testId} data-fils={fils}>
      <dt className="text-muted">{k}</dt>
      <dd className="font-medium">{v}</dd>
    </div>
  );
}
