import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { randomUUID } from "node:crypto";
import { Suspense } from "react";
import { saveDriverAction } from "@/app/profile/actions";
import { BookingSteps } from "@/components/booking-steps";
import { DriverForm } from "@/components/driver-form";
import { HoldCountdown } from "@/components/hold-countdown";
import { PaymentForm } from "@/components/payment-form";
import { PriceBreakdown } from "@/components/price-breakdown";
import { ReservationSummary } from "@/components/reservation-summary";
import { Alert } from "@/components/ui/alert";
import { PageLoading } from "@/components/ui/states";
import { driverInitial } from "@/lib/driver-initial";
import { reservationToLines } from "@/lib/price-lines";
import { getDriverProfile } from "@/server/data/drivers";
import { CANCELLATION_POLICY_TEXT } from "@/server/reservations/policy";
import { getReservationDetail } from "@/server/reservations/queries";
import { requireUser } from "@/server/session";
import { payAction } from "../actions";

export const metadata: Metadata = { title: "Checkout" };

export default function CheckoutPage({ params }: PageProps<"/checkout/[reservationId]">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <Checkout params={params} />
    </Suspense>
  );
}

async function Checkout({ params }: { params: PageProps<"/checkout/[reservationId]">["params"] }) {
  const { reservationId } = await params;
  const user = await requireUser(`/checkout/${reservationId}`);
  await connection();
  const detail = await getReservationDetail(reservationId, { userId: user.id });
  if (!detail) notFound();
  const r = detail.reservation;
  if (r.status === "CONFIRMED" || r.status === "PICKED_UP" || r.status === "RETURNED") redirect(`/rentals/${r.id}/voucher`);

  const now = new Date();
  const holdLive = r.status === "PENDING" && r.holdExpiresAt !== null && r.holdExpiresAt > now;
  if (!holdLive) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-12 sm:px-6">
        <Alert tone="error" title="This reservation can no longer be paid" testId="checkout-unavailable">
          {r.status === "CANCELLED" || r.status === "REFUNDED"
            ? "It was cancelled."
            : "Your hold on the car expired before payment was completed, so the car has been released. Nothing was charged for an unpaid hold."}
        </Alert>
        <Link href={`/vehicles/${detail.vehicle.id}`} className="btn-primary mt-6">
          Check this car again
        </Link>
      </div>
    );
  }

  const profile = await getDriverProfile(user.id);
  const driverReady = Boolean(profile?.licenceFileKey);
  const licence = profile?.licenceFileKey ? { url: `/api/files/licence/${profile.id}`, isPdf: profile.licenceFileKey.endsWith(".pdf") } : null;

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
      <BookingSteps current={2} />
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <span>
          Car held for you under reference <strong data-testid="checkout-reference">{r.reference}</strong>.
        </span>
        <span>
          Time left to pay: <HoldCountdown expiresAt={r.holdExpiresAt!.toISOString()} />
        </span>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_24rem]">
        <div className="min-w-0 space-y-6">
          <section className="card p-5 sm:p-6" aria-labelledby="driver-title">
            <div className="mb-4 flex items-center justify-between">
              <h1 id="driver-title" className="text-xl font-bold">
                1. Driver details
              </h1>
              {driverReady && <span className="badge bg-emerald-100 text-emerald-900">Saved</span>}
            </div>
            <DriverForm
              action={saveDriverAction}
              initial={driverInitial(profile, user.name, user.phone)}
              licence={licence}
              hiddenFields={{ returnTo: `/checkout/${r.id}` }}
              submitLabel={driverReady ? "Update driver details" : "Save driver details"}
            />
          </section>

          <section className="card p-5 sm:p-6" aria-labelledby="pay-title">
            <h2 id="pay-title" className="mb-4 text-xl font-bold">
              2. Payment
            </h2>
            <PaymentForm
              action={payAction}
              reservationId={r.id}
              totalFils={r.totalFils}
              depositFils={r.depositFils}
              idempotencyKey={randomUUID()}
              disabled={!driverReady}
              disabledReason="Save your driver details and upload your licence first."
            />
          </section>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <ReservationSummary d={detail} />
          <div className="card p-4">
            <PriceBreakdown price={reservationToLines(r, detail.extras)} />
          </div>
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
