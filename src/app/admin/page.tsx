import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { ActionForm } from "@/components/rental-actions";
import { PageHeader, PageLoading, StatusBadge } from "@/components/ui/states";
import { SubmitButton } from "@/components/ui/submit-button";
import { formatDateTime } from "@/lib/format";
import { listReservations, reservationStats, type ReservationListItem } from "@/server/reservations/queries";
import { requireAdmin } from "@/server/session";
import { findReservationAction } from "./actions";

export const metadata: Metadata = { title: "Admin" };

export default function AdminHome() {
  return (
    <div className="space-y-6">
      <PageHeader title="Overview" description="Today's counter work and the state of the fleet." />
      <ActionForm action={findReservationAction} className="card flex flex-col gap-2 p-4 sm:flex-row sm:items-end" testId="find-reservation-form">
        <div className="flex-1">
          <label htmlFor="find-q" className="label">
            Find a reservation
          </label>
          <input id="find-q" name="q" className="input" placeholder="Reference (DE-…) or scanned voucher QR text" autoComplete="off" />
        </div>
        <SubmitButton className="btn-primary" pendingText="Searching…">
          Open
        </SubmitButton>
      </ActionForm>
      <Suspense fallback={<PageLoading />}>
        <Dashboard />
      </Suspense>
    </div>
  );
}

async function Dashboard() {
  await requireAdmin();
  await connection();
  const now = new Date();
  const in24h = new Date(now.getTime() + 86_400_000);
  const [stats, upcoming, onRent] = await Promise.all([
    reservationStats(now),
    listReservations({ status: ["CONFIRMED"], from: now, to: in24h, limit: 50 }),
    listReservations({ status: ["PICKED_UP"], limit: 100 }),
  ]);
  const pickups = upcoming.filter((x) => x.reservation.pickupAt < in24h && x.reservation.pickupAt >= new Date(now.getTime() - 6 * 3_600_000));
  const returns = onRent.filter((x) => x.reservation.returnAt < in24h).sort((a, b) => a.reservation.returnAt.getTime() - b.reservation.returnAt.getTime());

  const tiles = [
    { label: "Pick-ups next 24h", value: stats.pickupsNext24h, href: "/admin/reservations?status=CONFIRMED" },
    { label: "Returns next 24h", value: stats.returnsNext24h, href: "/admin/reservations?status=PICKED_UP" },
    { label: "Overdue returns", value: stats.overdue, href: "/admin/reservations?status=PICKED_UP", warn: stats.overdue > 0 },
    { label: "On rent", value: stats.onRent, href: "/admin/reservations?status=PICKED_UP" },
    { label: "Confirmed", value: stats.confirmed, href: "/admin/reservations?status=CONFIRMED" },
    { label: "Unpaid holds", value: stats.pending, href: "/admin/reservations?status=PENDING" },
  ];

  return (
    <>
      <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6" data-testid="admin-stats">
        {tiles.map((t) => (
          <li key={t.label}>
            <Link href={t.href} className={`card block p-4 hover:shadow-md ${t.warn ? "border-red-300 bg-red-50" : ""}`}>
              <p className="text-xs text-muted">{t.label}</p>
              <p className={`mt-1 text-2xl font-bold tabular-nums ${t.warn ? "text-red-700" : ""}`}>{t.value}</p>
            </Link>
          </li>
        ))}
      </ul>
      <div className="grid gap-6 xl:grid-cols-2">
        <Agenda title="Pick-ups due" items={pickups} which="pickup" empty="No pick-ups in the next 24 hours." />
        <Agenda title="Returns due" items={returns} which="return" empty="No returns in the next 24 hours." />
      </div>
    </>
  );
}

function Agenda({ title, items, which, empty }: { title: string; items: ReservationListItem[]; which: "pickup" | "return"; empty: string }) {
  return (
    <section className="card p-4">
      <h2 className="mb-3 font-semibold">{title}</h2>
      {items.length === 0 ? (
        <p className="text-sm text-muted">{empty}</p>
      ) : (
        <ul className="divide-y divide-line">
          {items.map(({ reservation: r, vehicle: v, customer, pickupBranch, returnBranch }) => {
            const at = which === "pickup" ? r.pickupAt : r.returnAt;
            const b = which === "pickup" ? pickupBranch : returnBranch;
            const late = which === "return" && at < new Date();
            return (
              <li key={r.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <div className="min-w-0">
                  <Link href={`/admin/reservations/${r.id}`} className="font-mono font-semibold text-brand-700 hover:underline">
                    {r.reference}
                  </Link>{" "}
                  <span className="text-muted">· {customer.name}</span>
                  <p className="truncate text-muted">
                    {v.make} {v.model} ({v.plateNumber}) · {b.name}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className={late ? "font-semibold text-red-700" : ""}>{formatDateTime(at, b.timeZone)}</p>
                  {late ? <span className="badge bg-red-100 text-red-800">Overdue</span> : <StatusBadge status={r.status} />}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
