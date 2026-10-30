import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { EmptyState, PageHeader, PageLoading } from "@/components/ui/states";
import { listBranches } from "@/server/data/catalog";
import { requireAdmin } from "@/server/session";

export const metadata: Metadata = { title: "Branches · Admin" };

export default function AdminBranchesPage() {
  return (
    <div className="space-y-4">
      <PageHeader
        title="Branches"
        description="Rental locations, operating hours and contact information."
        actions={
          <Link href="/admin/branches/new" className="btn-primary" data-testid="add-branch">
            Add branch
          </Link>
        }
      />
      <Suspense fallback={<PageLoading />}>
        <BranchesTable />
      </Suspense>
    </div>
  );
}

async function BranchesTable() {
  await requireAdmin();
  await connection();
  const branches = await listBranches({ includeInactive: true });

  if (branches.length === 0) {
    return <EmptyState title="No branches found" action={{ href: "/admin/branches/new", label: "Add a branch" }} />;
  }

  return (
    <div className="card overflow-x-auto">
      <table className="table min-w-[50rem]">
        <thead>
          <tr>
            <th>Code</th>
            <th>Name</th>
            <th>City / Emirate</th>
            <th>Hours</th>
            <th>Contact</th>
            <th>Status</th>
            <th className="text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {branches.map((b) => (
            <tr key={b.id} data-testid="branch-row" data-code={b.code}>
              <td className="font-mono font-semibold text-brand-700">{b.code}</td>
              <td>
                <Link href={`/admin/branches/${b.id}`} className="font-medium text-ink hover:underline">
                  {b.name}
                </Link>
                <span className="block text-xs text-muted truncate max-w-xs">{b.addressLine}</span>
              </td>
              <td>
                {b.city}, {b.emirate}
              </td>
              <td className="text-sm">
                {b.is24Hours ? (
                  <span className="badge bg-green-100 text-green-800">24 Hours</span>
                ) : (
                  <span>
                    {b.opensAt} – {b.closesAt}
                  </span>
                )}
                <span className="block text-xs text-muted">{b.timeZone}</span>
              </td>
              <td className="text-xs text-muted">
                {b.phone && <p>{b.phone}</p>}
                {b.email && <p>{b.email}</p>}
              </td>
              <td>
                {b.isActive ? (
                  <span className="badge bg-emerald-100 text-emerald-800">Active</span>
                ) : (
                  <span className="badge bg-zinc-100 text-zinc-600">Inactive</span>
                )}
              </td>
              <td className="text-right">
                <Link href={`/admin/branches/${b.id}`} className="btn-secondary text-xs">
                  Edit
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
