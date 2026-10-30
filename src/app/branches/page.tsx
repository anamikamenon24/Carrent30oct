import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { EmptyState, PageHeader, Skeleton } from "@/components/ui/states";
import { listBranches } from "@/server/data/catalog";
import { BranchHours } from "./branch-hours";

export const metadata: Metadata = { title: "Branches" };

export default function BranchesPage() {
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">
      <PageHeader title="Our branches" description="Pick up and return at any DriveEasy branch. One-way rentals between cities are welcome." />
      <Suspense fallback={<BranchGridSkeleton />}>
        <BranchGrid />
      </Suspense>
    </div>
  );
}

function BranchGridSkeleton() {
  return (
    <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-hidden>
      {Array.from({ length: 6 }, (_, i) => (
        <Skeleton key={i} className="h-44" />
      ))}
    </div>
  );
}

async function BranchGrid() {
  const branches = await listBranches();
  if (branches.length === 0) {
    return (
      <div className="mt-6">
        <EmptyState title="No branches yet" description="Branches will appear here as soon as they open." />
      </div>
    );
  }
  return (
    <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {branches.map((b) => (
        <li key={b.id} className="card flex flex-col p-5" data-testid="branch-card" data-code={b.code}>
          <div className="flex items-start justify-between gap-2">
            <h2 className="text-lg font-semibold">
              <Link href={`/branches/${b.code}`} className="hover:text-brand-700">
                {b.name}
              </Link>
            </h2>
            <span className="badge bg-brand-50 font-mono text-brand-800">{b.code}</span>
          </div>
          <p className="mt-1 text-sm text-muted">
            {b.addressLine}, {b.city}, {b.emirate}
          </p>
          <p className="mt-3 text-sm">
            <BranchHours branch={b} />
          </p>
          {b.phone && <p className="mt-1 text-sm text-muted">{b.phone}</p>}
          <div className="mt-auto flex gap-2 pt-4">
            <Link href={`/search?pickup=${b.code}`} className="btn-primary flex-1">
              Rent here
            </Link>
            <Link href={`/branches/${b.code}`} className="btn-secondary">
              Details
            </Link>
          </div>
        </li>
      ))}
    </ul>
  );
}
