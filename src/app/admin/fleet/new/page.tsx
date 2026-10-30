import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { VehicleForm } from "@/components/admin-forms";
import { PageHeader, PageLoading } from "@/components/ui/states";
import { listBranches, listCategories, listFeatures } from "@/server/data/catalog";
import { requireAdmin } from "@/server/session";
import { createVehicleAction } from "../../actions";

export const metadata: Metadata = { title: "Add vehicle · Admin" };

export default function NewVehiclePage() {
  return (
    <div className="space-y-4">
      <Link href="/admin/fleet" className="text-sm text-muted hover:text-ink">
        ← Fleet
      </Link>
      <PageHeader title="Add vehicle" />
      <Suspense fallback={<PageLoading />}>
        <NewVehicle />
      </Suspense>
    </div>
  );
}

async function NewVehicle() {
  await requireAdmin();
  await connection();
  const [branches, categories, features] = await Promise.all([listBranches({ includeInactive: true }), listCategories(), listFeatures()]);
  return (
    <div className="card p-5">
      <VehicleForm
        action={createVehicleAction}
        categories={categories.map((c) => ({ id: c.id, name: c.name }))}
        branches={branches.map((b) => ({ id: b.id, name: b.name }))}
        features={features.map((f) => ({ id: f.id, name: f.name }))}
        submitLabel="Add vehicle"
      />
    </div>
  );
}
