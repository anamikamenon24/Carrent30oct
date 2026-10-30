import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { EmptyState, PageHeader, PageLoading, StatusBadge } from "@/components/ui/states";
import { VehicleVisual } from "@/components/vehicle-visual";
import { formatAED, titleCase } from "@/lib/format";
import { listBranches, listCategories, listVehicles } from "@/server/data/catalog";
import { requireAdmin } from "@/server/session";

export const metadata: Metadata = { title: "Fleet · Admin" };

const STATUSES = ["AVAILABLE", "RESERVED", "ON_RENT", "MAINTENANCE", "RETIRED"] as const;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default function FleetPage({ searchParams }: PageProps<"/admin/fleet">) {
  return (
    <div className="space-y-4">
      <PageHeader
        title="Fleet"
        description="Every car, where it is based and its status."
        actions={
          <Link href="/admin/fleet/new" className="btn-primary" data-testid="add-vehicle">
            Add vehicle
          </Link>
        }
      />
      <Suspense fallback={<PageLoading />}>
        <FleetTable searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function FleetTable({ searchParams }: { searchParams: PageProps<"/admin/fleet">["searchParams"] }) {
  await requireAdmin();
  const sp = await searchParams;
  await connection();
  const branchId = one(sp.branch);
  const categoryId = one(sp.category);
  const status = one(sp.status) as (typeof STATUSES)[number] | "";
  const [branches, categories, vehicles] = await Promise.all([
    listBranches({ includeInactive: true }),
    listCategories(),
    listVehicles({
      branchId: branchId || undefined,
      categoryId: categoryId || undefined,
      status: status && STATUSES.includes(status) ? [status] : undefined,
    }),
  ]);
  const branchName = new Map(branches.map((b) => [b.id, b.name]));

  return (
    <>
      <Form action="/admin/fleet" className="card grid gap-3 p-4 sm:grid-cols-4 sm:items-end">
        <div>
          <label htmlFor="fb" className="label">
            Branch
          </label>
          <select id="fb" name="branch" defaultValue={branchId} className="input">
            <option value="">All</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="fc" className="label">
            Category
          </label>
          <select id="fc" name="category" defaultValue={categoryId} className="input">
            <option value="">All</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="fs" className="label">
            Status
          </label>
          <select id="fs" name="status" defaultValue={status} className="input">
            <option value="">All</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {titleCase(s)}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn-primary">
          Filter
        </button>
      </Form>
      {vehicles.length === 0 ? (
        <EmptyState title="No vehicles match" action={{ href: "/admin/fleet/new", label: "Add a vehicle" }} />
      ) : (
        <div className="card overflow-x-auto">
          <table className="table min-w-[50rem]">
            <thead>
              <tr>
                <th />
                <th>Vehicle</th>
                <th>Plate</th>
                <th>Category</th>
                <th>Base branch</th>
                <th>Status</th>
                <th className="text-right">Daily rate</th>
              </tr>
            </thead>
            <tbody>
              {vehicles.map((v) => (
                <tr key={v.id} data-testid="fleet-row" data-plate={v.plateNumber}>
                  <td className="w-20">
                    <div className="h-10 w-16 overflow-hidden rounded">
                      <VehicleVisual photos={v.photos} color={v.color} alt="" />
                    </div>
                  </td>
                  <td>
                    <Link href={`/admin/fleet/${v.id}`} className="font-medium text-brand-700 hover:underline">
                      {v.make} {v.model}
                    </Link>
                    <span className="block text-xs text-muted">
                      {v.year} · {v.seats} seats · {titleCase(v.transmission)}
                    </span>
                  </td>
                  <td className="font-mono">{v.plateNumber}</td>
                  <td>{v.category.name}</td>
                  <td>{branchName.get(v.branchId) ?? "—"}</td>
                  <td>
                    <StatusBadge status={v.status} />
                  </td>
                  <td className="text-right tabular-nums">{formatAED(v.dailyRateFils)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
