/* eslint-disable @next/next/no-img-element -- QR is an inline data URL */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { BookingSteps } from "@/components/booking-steps";
import { PrintButton } from "@/components/print-button";
import { Alert } from "@/components/ui/alert";
import { PageLoading, StatusBadge } from "@/components/ui/states";
import { formatAED, formatDateTime, titleCase } from "@/lib/format";
import { getReservationDetail } from "@/server/reservations/queries";
import { requireUser } from "@/server/session";
import { voucherQrDataUrl } from "@/server/voucher";

export const metadata: Metadata = { title: "Pick-up voucher" };

export default function VoucherPage({ params }: PageProps<"/rentals/[id]/voucher">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <Voucher params={params} />
    </Suspense>
  );
}

async function Voucher({ params }: { params: PageProps<"/rentals/[id]/voucher">["params"] }) {
  const { id } = await params;
  const user = await requireUser(`/rentals/${id}/voucher`);
  await connection();
  // Admins may open any voucher (e.g. at the counter); customers only their own.
  const d = await getReservationDetail(id, user.role === "ADMIN" ? {} : { userId: user.id });
  if (!d) notFound();
  const r = d.reservation;
  if (r.status === "PENDING") redirect(`/checkout/${r.id}`);
  const valid = r.status === "CONFIRMED" || r.status === "PICKED_UP";
  const qr = valid ? await voucherQrDataUrl(r.reference, r.id) : null;
  const deposit = d.deposits.find((x) => x.status === "HELD" || x.status === "PARTIALLY_CAPTURED");

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 print:max-w-none print:p-0">
      <div className="print:hidden">
        <BookingSteps current={3} />
        {r.status === "CONFIRMED" && (
          <Alert tone="success" title="You're booked!" className="mt-4">
            Your payment went through and the car is reserved. Show this voucher at the counter.
          </Alert>
        )}
      </div>

      <article className="card mt-6 overflow-hidden print:border-0 print:shadow-none" data-testid="voucher">
        <header className="flex flex-wrap items-center justify-between gap-2 bg-brand-950 px-6 py-4 text-white">
          <div>
            <p className="text-xs tracking-wide text-brand-300 uppercase">DriveEasy pick-up voucher</p>
            <p className="font-mono text-2xl font-bold tracking-wider" data-testid="voucher-reference">
              {r.reference}
            </p>
          </div>
          <StatusBadge status={r.status} testId="voucher-status" />
        </header>
        <div className="grid gap-6 p-6 sm:grid-cols-[1fr_auto]">
          <div className="space-y-4 text-sm">
            {!valid && (
              <Alert tone="warning">This voucher is no longer valid ({titleCase(r.status)}).</Alert>
            )}
            <div>
              <p className="text-xs font-semibold text-muted uppercase">Driver</p>
              <p className="font-medium">
                {d.driverProfile ? `${d.driverProfile.firstName} ${d.driverProfile.lastName}` : d.customer.name}
              </p>
              {d.driverProfile && <p className="text-muted">Licence {d.driverProfile.licenceNumber}</p>}
            </div>
            <div>
              <p className="text-xs font-semibold text-muted uppercase">Car</p>
              <p className="font-medium">
                {d.vehicle.make} {d.vehicle.model} ({d.vehicle.category.name}) or similar
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-xs font-semibold text-muted uppercase">Pick-up</p>
                <p className="font-medium" data-testid="voucher-pickup">
                  {formatDateTime(r.pickupAt, d.pickupBranch.timeZone)}
                </p>
                <p>{d.pickupBranch.name}</p>
                <p className="text-muted">
                  {d.pickupBranch.addressLine}, {d.pickupBranch.city}
                </p>
                {d.pickupBranch.phone && <p className="text-muted">{d.pickupBranch.phone}</p>}
              </div>
              <div>
                <p className="text-xs font-semibold text-muted uppercase">Return</p>
                <p className="font-medium" data-testid="voucher-return">
                  {formatDateTime(r.returnAt, d.returnBranch.timeZone)}
                </p>
                <p>{d.returnBranch.name}</p>
                <p className="text-muted">
                  {d.returnBranch.addressLine}, {d.returnBranch.city}
                </p>
              </div>
            </div>
            {d.extras.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted uppercase">Extras</p>
                <p>{d.extras.map((e) => (e.quantity > 1 ? `${e.name} × ${e.quantity}` : e.name)).join(", ")}</p>
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-xs font-semibold text-muted uppercase">Paid</p>
                <p className="font-medium" data-testid="voucher-total">
                  {formatAED(r.totalFils)} <span className="font-normal text-muted">incl. VAT</span>
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold text-muted uppercase">Deposit hold</p>
                <p className="font-medium">
                  {formatAED(r.depositFils)} <span className="font-normal text-muted">{deposit ? "held" : ""}</span>
                </p>
              </div>
            </div>
            <p className="text-xs text-muted">
              Bring your driving licence, passport or Emirates ID, and the card used for payment. Times are local to each branch.
            </p>
          </div>
          {qr && (
            <div className="flex flex-col items-center gap-2">
              <img src={qr} alt={`QR code for reservation ${r.reference}`} width={200} height={200} className="size-48 rounded-lg border border-line" data-testid="voucher-qr" />
              <p className="text-xs text-muted">Scan at the counter</p>
            </div>
          )}
        </div>
      </article>

      <div className="mt-6 flex flex-wrap gap-2 print:hidden">
        <PrintButton />
        <Link href={`/rentals/${r.id}`} className="btn-secondary">
          Manage reservation
        </Link>
        <Link href="/rentals" className="btn-ghost">
          All my rentals
        </Link>
      </div>
    </div>
  );
}
