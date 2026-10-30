import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { EmptyState, PageHeader, PageLoading, StatusBadge } from "@/components/ui/states";
import { formatAED, formatDateTime } from "@/lib/format";
import { listBranches } from "@/server/data/catalog";
import { listReservations, type ReservationStatus } from "@/server/reservations/queries";
import { requireAdmin } from "@/server/session";

export const metadata: Metadata = { title: "Reservations · Admin" };

const STATUSES: ReservationStatus[] = ["PENDING", "CONFIRMED", "PICKED_UP", "RETURNED", "CANCELLED", "EXPIRED", "REFUNDED"];

export default function AdminReservationsPage({ searchParams }: PageProps<"/admin/reservations">) {
  return (
    <div className="space-y-4">
      <PageHeader title="Reservations" description="Search, check cars out and in, and handle changes." />
      <Suspense fallback={<PageLoading />}>
        <ReservationsTable searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

async function ReservationsTable({ searchParams }: { searchParams: PageProps<"/admin/reservations">["searchParams"] }) {
  await requireAdmin();
  const sp = await searchParams;
  await connection();
  const status = one(sp.status) as ReservationStatus | "";
  const branch = one(sp.branch);
  const q = one(sp.q);
  const branches = await listBranches({ includeInactive: true });
  const rows = await listReservations({
    status: status && STATUSES.includes(status) ? [status] : undefined,
    branchId: branch || undefined,
    q: q || undefined,
    limit: 300,
  });

  return (
    <>
      <Form action="/admin/reservations" className="card grid gap-3 p-4 sm:grid-cols-[1fr_12rem_14rem_auto] sm:items-end" data-testid="reservation-filters">
        <div>
          <label htmlFor="rq" className="label">
            Search
          </label>
          <input id="rq" name="q" defaultValue={q} className="input" placeholder="Reference, customer, email or plate" />
        </div>
        <div>
          <label htmlFor="rs" className="label">
            Status
          </label>
          <select id="rs" name="status" defaultValue={status} className="input">
            <option value="">All</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace("_", " ").toLowerCase()}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="rb" className="label">
            Branch
          </label>
          <select id="rb" name="branch" defaultValue={branch} className="input">
            <option value="">All branches</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn-primary">
          Filter
        </button>
      </Form>

      {rows.length === 0 ? (
        <EmptyState title="No reservations found" description="Try a different search or status." />
      ) : (
        <div className="card overflow-x-auto">
          <table className="table min-w-[52rem]">
            <thead>
              <tr>
                <th>Reference</th>
                <th>Customer</th>
                <th>Car</th>
                <th>Pick-up</th>
                <th>Return</th>
                <th>Status</th>
                <th className="text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ reservation: r, vehicle: v, customer, pickupBranch: pb, returnBranch: rb }) => (
                <tr key={r.id} data-testid="admin-reservation-row" data-reference={r.reference}>
                  <td>
                    <Link href={`/admin/reservations/${r.id}`} className="font-mono font-semibold text-brand-700 hover:underline">
                      {r.reference}
                    </Link>
                  </td>
                  <td>
                    {customer.name}
                    <span className="block text-xs text-muted">{customer.email}</span>
                  </td>
                  <td>
                    {v.make} {v.model}
                    <span className="block text-xs text-muted">{v.plateNumber}</span>
                  </td>
                  <td className="whitespace-nowrap">
                    {formatDateTime(r.pickupAt, pb.timeZone)}
                    <span className="block text-xs text-muted">{pb.code}</span>
                  </td>
                  <td className="whitespace-nowrap">
                    {formatDateTime(r.returnAt, rb.timeZone)}
                    <span className="block text-xs text-muted">{rb.code}</span>
                  </td>
                  <td>
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="text-right tabular-nums">{formatAED(r.totalFils)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
