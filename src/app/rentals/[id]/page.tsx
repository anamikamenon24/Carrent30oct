import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { randomUUID } from "node:crypto";
import { Suspense } from "react";
import { PaymentsTable } from "@/components/payments-table";
import { PriceBreakdown } from "@/components/price-breakdown";
import { ActionForm, CancelReservation } from "@/components/rental-actions";
import { ReservationSummary } from "@/components/reservation-summary";
import { TripFields } from "@/components/trip-fields";
import { Alert } from "@/components/ui/alert";
import { PageLoading, StatusBadge } from "@/components/ui/states";
import { SubmitButton } from "@/components/ui/submit-button";
import { formatAED, formatDateTime } from "@/lib/format";
import { quoteToLines, reservationToLines } from "@/lib/price-lines";
import { isLocalDateTime, localDateKey, localToUtc, utcToLocal } from "@/lib/tz";
import { previewModification } from "@/server/reservations/changes";
import { isReservationError } from "@/server/reservations/errors";
import { CANCELLATION_POLICY_TEXT } from "@/server/reservations/policy";
import { getReservationDetail } from "@/server/reservations/queries";
import { requireUser } from "@/server/session";
import { cancelReservationAction, modifyDatesAction } from "../actions";

export const metadata: Metadata = { title: "Reservation" };

export default function RentalPage({ params, searchParams }: PageProps<"/rentals/[id]">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <Rental params={params} searchParams={searchParams} />
    </Suspense>
  );
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

async function Rental({ params, searchParams }: { params: PageProps<"/rentals/[id]">["params"]; searchParams: PageProps<"/rentals/[id]">["searchParams"] }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const user = await requireUser(`/rentals/${id}`);
  await connection();
  const d = await getReservationDetail(id, { userId: user.id });
  if (!d) notFound();
  const r = d.reservation;
  const tz = d.pickupBranch.timeZone;

  // Date-change preview (?start=&end=, branch-local), priced on the server.
  const startQ = first(sp.startDate) && first(sp.startTime) ? `${first(sp.startDate)}T${first(sp.startTime)}` : undefined;
  const endQ = first(sp.endDate) && first(sp.endTime) ? `${first(sp.endDate)}T${first(sp.endTime)}` : undefined;
  let preview: Awaited<ReturnType<typeof previewModification>> | null = null;
  let previewError: string | null = null;
  if (d.modification.allowed && startQ && endQ) {
    if (!isLocalDateTime(startQ) || !isLocalDateTime(endQ)) previewError = "Choose valid dates.";
    else {
      try {
        preview = await previewModification({
          reservationId: r.id,
          actor: { userId: user.id, role: "CUSTOMER" },
          pickupAt: localToUtc(startQ, tz),
          returnAt: localToUtc(endQ, tz),
        });
      } catch (err) {
        if (!isReservationError(err)) throw err;
        previewError = err.message;
      }
    }
  }

  const c = d.cancellation;
  const paidFils = d.payments.filter((p) => p.status === "SUCCEEDED" || p.status === "PARTIALLY_REFUNDED").reduce((s, p) => s + p.amountFils - p.refundedFils, 0);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      <nav className="text-sm text-muted" aria-label="Breadcrumb">
        <Link href="/rentals" className="hover:text-ink">
          My rentals
        </Link>{" "}
        / <span className="text-ink">{r.reference}</span>
      </nav>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <h1 className="font-mono text-2xl font-bold" data-testid="rental-reference">
          {r.reference}
        </h1>
        <StatusBadge status={r.status} testId="rental-status" />
      </div>
      {first(sp.cancelled) && (
        <Alert tone="success" className="mt-4" testId="cancel-success">
          Your reservation was cancelled. {r.refundedFils > 0 ? `${formatAED(r.refundedFils)} is being refunded to your card.` : ""} The deposit hold
          has been released.
        </Alert>
      )}
      {first(sp.modified) && (
        <Alert tone="success" className="mt-4" testId="modify-success">
          Your dates were changed. The voucher has been updated.
        </Alert>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="min-w-0 space-y-6">
          <ReservationSummary d={d} />

          <div className="flex flex-wrap gap-2">
            {r.status === "PENDING" && (
              <Link href={`/checkout/${r.id}`} className="btn-primary">
                Complete payment
              </Link>
            )}
            {(r.status === "CONFIRMED" || r.status === "PICKED_UP") && (
              <Link href={`/rentals/${r.id}/voucher`} className="btn-primary" data-testid="view-voucher">
                View voucher
              </Link>
            )}
          </div>

          {d.modification.allowed && (
            <section className="card p-5" aria-labelledby="modify-title">
              <h2 id="modify-title" className="text-lg font-semibold">
                Change dates
              </h2>
              <p className="mt-1 text-sm text-muted">Same car and branches. The price difference is charged or refunded. Times in {tz}.</p>
              <Form action={`/rentals/${r.id}`} className="mt-4" data-testid="modify-dates-form" scroll={false}>
                <TripFields
                  branches={[]}
                  showBranches={false}
                  start={startQ ?? utcToLocal(r.pickupAt, tz)}
                  end={endQ ?? utcToLocal(r.returnAt, tz)}
                  minDate={localDateKey(new Date(), tz)}
                />
                <button type="submit" className="btn-secondary mt-3" data-testid="modify-dates-button">
                  Check new price
                </button>
              </Form>
              {previewError && (
                <Alert tone="error" className="mt-4">
                  {previewError}
                </Alert>
              )}
              {preview && (
                <div className="mt-4 space-y-3 rounded-xl border border-line p-4" data-testid="modify-preview">
                  {!preview.allowed ? (
                    <Alert tone="error">{preview.reason ?? "These dates are not available."}</Alert>
                  ) : (
                    <>
                      <p className="text-sm">
                        New total <strong>{formatAED(preview.quote.totalFils)}</strong>{" "}
                        <span data-testid="modify-difference" data-fils={preview.differenceFils}>
                          ({preview.differenceFils > 0 ? `you pay ${formatAED(preview.differenceFils)} more` : preview.differenceFils < 0 ? `${formatAED(-preview.differenceFils)} refunded` : "no price change"})
                        </span>
                      </p>
                      <details className="text-sm">
                        <summary className="cursor-pointer text-brand-700">See the new price breakdown</summary>
                        <div className="mt-3">
                          <PriceBreakdown price={quoteToLines(preview.quote)} title="New price" />
                        </div>
                      </details>
                      <ActionForm action={modifyDatesAction} className="space-y-3" testId="modify-confirm-form">
                        <input type="hidden" name="reservationId" value={r.id} />
                        <input type="hidden" name="newStart" value={startQ} />
                        <input type="hidden" name="newEnd" value={endQ} />
                        <input type="hidden" name="idempotencyKey" value={randomUUID()} />
                        {preview.differenceFils > 0 && r.status === "CONFIRMED" && (
                          <div>
                            <label htmlFor="mod-pm" className="label">
                              Card for the difference
                            </label>
                            <select id="mod-pm" name="paymentMethod" className="input" defaultValue="pm_fake_success" data-testid="modify-payment-method">
                              <option value="pm_fake_success">Test card – succeeds (•••• 4242)</option>
                              <option value="pm_fake_fail">Test card – declined (•••• 0002)</option>
                            </select>
                          </div>
                        )}
                        <SubmitButton pendingText="Changing dates…" testId="confirm-modify">
                          Confirm new dates
                        </SubmitButton>
                      </ActionForm>
                    </>
                  )}
                </div>
              )}
            </section>
          )}
          {!d.modification.allowed && ["PENDING", "CONFIRMED"].includes(r.status) && d.modification.reason && (
            <p className="text-sm text-muted" data-testid="modify-not-allowed">
              Date changes: {d.modification.reason}.
            </p>
          )}

          <section className="card p-5" aria-labelledby="pay-title">
            <h2 id="pay-title" className="mb-3 text-lg font-semibold">
              Payments
            </h2>
            <PaymentsTable payments={d.payments} deposits={d.deposits} timeZone={tz} />
          </section>

          {d.agreement && (
            <section className="card p-5 text-sm" aria-labelledby="agr-title">
              <h2 id="agr-title" className="mb-3 text-lg font-semibold">
                Rental agreement {d.agreement.agreementNumber}
              </h2>
              <dl className="grid gap-3 sm:grid-cols-2">
                <div>
                  <dt className="text-muted">Picked up</dt>
                  <dd>
                    {formatDateTime(d.agreement.checkedOutAt, tz)} · {d.agreement.pickupMileageKm.toLocaleString("en")} km · fuel {d.agreement.pickupFuelEighths}/8
                  </dd>
                </div>
                {d.agreement.returnedAt && (
                  <div>
                    <dt className="text-muted">Returned</dt>
                    <dd>
                      {formatDateTime(d.agreement.returnedAt, d.returnBranch.timeZone)} · {d.agreement.returnMileageKm?.toLocaleString("en")} km · fuel{" "}
                      {d.agreement.returnFuelEighths}/8
                    </dd>
                  </div>
                )}
                {(d.agreement.returnChargesFils ?? 0) > 0 && (
                  <div>
                    <dt className="text-muted">Return charges (incl. VAT)</dt>
                    <dd>{formatAED(d.agreement.returnChargesFils ?? 0)}</dd>
                  </div>
                )}
              </dl>
            </section>
          )}
        </div>

        <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <div className="card p-4">
            <PriceBreakdown price={reservationToLines(r, d.extras)} title="Your price" />
            {paidFils > 0 && <p className="mt-3 text-xs text-muted">Paid so far (net of refunds): {formatAED(paidFils)}</p>}
          </div>
          {c.allowed && ["PENDING", "CONFIRMED"].includes(r.status) && (
            <div className="card p-4">
              <CancelReservation
                action={cancelReservationAction}
                reservationId={r.id}
                summary={
                  c.tier === "UNPAID" ? (
                    <p>This reservation hasn&rsquo;t been paid, so cancelling is free.</p>
                  ) : c.feeFils === 0 ? (
                    <p data-testid="cancel-fee" data-fils={0}>
                      Free cancellation: you get a full refund of {formatAED(paidFils)}.
                    </p>
                  ) : (
                    <p data-testid="cancel-fee" data-fils={c.feeFils}>
                      Cancellation fee {formatAED(c.feeFils)}. You get {formatAED(Math.max(0, paidFils - c.feeFils))} back.
                    </p>
                  )
                }
              />
            </div>
          )}
          {!c.allowed && c.reason && ["CONFIRMED"].includes(r.status) && (
            <p className="text-sm text-muted" data-testid="cancel-not-allowed">
              Online cancellation is not available: {c.reason}.
            </p>
          )}
          <details className="card p-4 text-sm">
            <summary className="cursor-pointer font-semibold">Cancellation policy</summary>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
              {CANCELLATION_POLICY_TEXT.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </details>
        </aside>
      </div>
    </div>
  );
}
