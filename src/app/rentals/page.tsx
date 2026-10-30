import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { EmptyState, PageHeader, PageLoading, StatusBadge } from "@/components/ui/states";
import { VehicleVisual } from "@/components/vehicle-visual";
import { formatAED, formatDateTime } from "@/lib/format";
import { listUserReservations, type ReservationListItem } from "@/server/reservations/queries";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "My rentals" };

export default function RentalsPage() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <PageHeader title="My rentals" description="View vouchers, change dates or cancel upcoming reservations." actions={<Link href="/search" className="btn-primary">Book a car</Link>} />
      <Suspense fallback={<PageLoading />}>
        <RentalsList />
      </Suspense>
    </div>
  );
}

async function RentalsList() {
  const user = await requireUser("/rentals");
  await connection();
  const all = await listUserReservations(user.id);
  if (all.length === 0) {
    return (
      <div className="mt-6">
        <EmptyState title="No rentals yet" description="When you book a car it will show up here with its voucher." action={{ href: "/search", label: "Find a car" }} />
      </div>
    );
  }
  const now = Date.now();
  const upcoming = all
    .filter((x) => ["PENDING", "CONFIRMED", "PICKED_UP"].includes(x.reservation.status) && x.reservation.returnAt.getTime() > now - 86_400_000)
    .sort((a, b) => a.reservation.pickupAt.getTime() - b.reservation.pickupAt.getTime());
  const past = all.filter((x) => !upcoming.includes(x));

  return (
    <div className="mt-6 space-y-8">
      <Group title="Upcoming and active" items={upcoming} empty="No upcoming rentals." />
      <Group title="Past and cancelled" items={past} empty="Nothing here yet." />
    </div>
  );
}

function Group({ title, items, empty }: { title: string; items: ReservationListItem[]; empty: string }) {
  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold">{title}</h2>
      {items.length === 0 ? (
        <p className="text-sm text-muted">{empty}</p>
      ) : (
        <ul className="space-y-3">
          {items.map(({ reservation: r, vehicle: v, pickupBranch: pb, returnBranch: rb }) => (
            <li key={r.id} className="card flex flex-col overflow-hidden sm:flex-row" data-testid="rental-row" data-reference={r.reference} data-status={r.status}>
              <div className="h-32 sm:h-auto sm:w-44 sm:shrink-0">
                <VehicleVisual photos={v.photos} alt={`${v.make} ${v.model}`} />
              </div>
              <div className="flex flex-1 flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono font-semibold">{r.reference}</span>
                    <StatusBadge status={r.status} />
                  </div>
                  <p className="mt-1 text-base font-semibold">
                    {v.make} {v.model}
                  </p>
                  <p className="text-muted">
                    {formatDateTime(r.pickupAt, pb.timeZone)} · {pb.name}
                  </p>
                  <p className="text-muted">
                    → {formatDateTime(r.returnAt, rb.timeZone)} · {rb.name}
                  </p>
                </div>
                <div className="flex shrink-0 flex-row items-center gap-2 sm:flex-col sm:items-end">
                  <p className="font-semibold tabular-nums">{formatAED(r.totalFils)}</p>
                  <div className="flex gap-2">
                    {r.status === "PENDING" ? (
                      <Link href={`/checkout/${r.id}`} className="btn-primary">
                        Complete payment
                      </Link>
                    ) : (
                      (r.status === "CONFIRMED" || r.status === "PICKED_UP") && (
                        <Link href={`/rentals/${r.id}/voucher`} className="btn-secondary" data-testid="view-voucher">
                          Voucher
                        </Link>
                      )
                    )}
                    <Link href={`/rentals/${r.id}`} className="btn-secondary" data-testid="manage-rental">
                      Details
                    </Link>
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
