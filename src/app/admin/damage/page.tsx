import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { ActionForm } from "@/components/rental-actions";
import { EmptyState, PageHeader, PageLoading } from "@/components/ui/states";
import { SubmitButton } from "@/components/ui/submit-button";
import { formatAED, formatDateTime, titleCase } from "@/lib/format";
import { listVehicles } from "@/server/data/catalog";
import { listDamageReports } from "@/server/reservations/operations";
import { requireAdmin } from "@/server/session";
import { createDamageAction, updateDamageStatusAction } from "../actions";

export const metadata: Metadata = { title: "Damage Reports · Admin" };

export default function AdminDamagePage() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Damage Reports"
        description="Record and track vehicle condition, incident damage, and repair charges."
      />
      <Suspense fallback={<PageLoading />}>
        <DamageContent />
      </Suspense>
    </div>
  );
}

async function DamageContent() {
  await requireAdmin();
  await connection();
  const [reports, vehicles] = await Promise.all([
    listDamageReports(),
    listVehicles(),
  ]);

  return (
    <div className="space-y-8">
      {/* Log Damage Report Card */}
      <section className="card p-6">
        <h2 className="text-lg font-semibold text-ink mb-4">Log New Damage Report</h2>
        <ActionForm action={createDamageAction} className="space-y-4" testId="new-damage-form">
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label htmlFor="vehicleId" className="label text-xs">
                Vehicle *
              </label>
              <select id="vehicleId" name="vehicleId" required className="input text-sm">
                <option value="">Select vehicle…</option>
                {vehicles.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.make} {v.model} ({v.plateNumber})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="reservationRef" className="label text-xs">
                Reservation Reference
              </label>
              <input id="reservationRef" name="reservationRef" placeholder="DE-…" className="input text-sm uppercase" />
            </div>
            <div>
              <label htmlFor="stage" className="label text-xs">
                Stage
              </label>
              <select id="stage" name="stage" defaultValue="RETURN" className="input text-sm">
                <option value="PICKUP">Pick-up inspection</option>
                <option value="RETURN">Return inspection</option>
                <option value="OTHER">During rental / Other</option>
              </select>
            </div>
            <div>
              <label htmlFor="severity" className="label text-xs">
                Severity
              </label>
              <select id="severity" name="severity" defaultValue="MINOR" className="input text-sm">
                <option value="MINOR">Minor (scratch, small dent)</option>
                <option value="MODERATE">Moderate (deep scratch, panel damage)</option>
                <option value="MAJOR">Major (structural, collision)</option>
              </select>
            </div>
            <div>
              <label htmlFor="location" className="label text-xs">
                Damage Location
              </label>
              <input id="location" name="location" placeholder="e.g. Front bumper right" className="input text-sm" />
            </div>
            <div>
              <label htmlFor="estimatedCost" className="label text-xs">
                Estimated Repair (AED)
              </label>
              <input id="estimatedCost" name="estimatedCost" type="number" step="0.01" placeholder="500" className="input text-sm" />
            </div>
            <div>
              <label htmlFor="charge" className="label text-xs">
                Customer Charge (AED)
              </label>
              <input id="charge" name="charge" type="number" step="0.01" placeholder="0" className="input text-sm" />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="description" className="label text-xs">
                Description *
              </label>
              <input id="description" name="description" required placeholder="Detailed notes on damage observed" className="input text-sm" />
            </div>
            <div className="sm:col-span-3">
              <label htmlFor="images" className="label text-xs">
                Photos (up to 12)
              </label>
              <input id="images" name="images" type="file" multiple accept="image/*" className="input text-sm" />
            </div>
          </div>
          <div className="flex justify-end pt-2">
            <SubmitButton className="btn-primary" pendingText="Saving report…">
              Submit damage report
            </SubmitButton>
          </div>
        </ActionForm>
      </section>

      {/* Reports Table */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-ink">Recent Damage Reports</h2>
        {reports.length === 0 ? (
          <EmptyState title="No damage reports logged" />
        ) : (
          <div className="card overflow-x-auto">
            <table className="table min-w-[55rem]">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Vehicle</th>
                  <th>Stage & Severity</th>
                  <th>Description</th>
                  <th>Repair / Charge</th>
                  <th>Status</th>
                  <th className="text-right">Update Status</th>
                </tr>
              </thead>
              <tbody>
                {reports.map(({ report: r, vehicle: v, reservationReference }) => (
                  <tr key={r.id} data-testid="damage-row">
                    <td className="text-xs text-muted whitespace-nowrap">
                      {formatDateTime(r.createdAt, "Asia/Dubai")}
                    </td>
                    <td>
                      <p className="font-medium text-ink">
                        {v.make} {v.model}
                      </p>
                      <span className="font-mono text-xs text-muted">{v.plateNumber}</span>
                      {reservationReference && r.reservationId && (
                        <Link
                          href={`/admin/reservations/${r.reservationId}`}
                          className="block text-xs font-mono text-brand-700 hover:underline"
                        >
                          {reservationReference}
                        </Link>
                      )}
                    </td>
                    <td>
                      <span className="badge bg-zinc-100 text-zinc-800 text-xs mr-1">
                        {titleCase(r.stage)}
                      </span>
                      <span
                        className={`badge text-xs ${
                          r.severity === "MAJOR"
                            ? "bg-red-100 text-red-800"
                            : r.severity === "MODERATE"
                              ? "bg-amber-100 text-amber-800"
                              : "bg-blue-100 text-blue-800"
                        }`}
                      >
                        {titleCase(r.severity)}
                      </span>
                      {r.location && <p className="text-xs text-muted mt-1">{r.location}</p>}
                    </td>
                    <td className="max-w-xs text-sm">
                      <p className="truncate">{r.description}</p>
                      {r.photoKeys.length > 0 && (
                        <p className="text-xs text-brand-600 mt-0.5">
                          {r.photoKeys.length} photo{r.photoKeys.length > 1 ? "s" : ""}
                        </p>
                      )}
                    </td>
                    <td className="text-sm font-mono tabular-nums">
                      {r.estimatedCostFils ? (
                        <p className="text-xs text-muted">Est: {formatAED(r.estimatedCostFils)}</p>
                      ) : null}
                      <p className="font-semibold text-ink">Charge: {formatAED(r.chargeFils)}</p>
                    </td>
                    <td>
                      <span
                        className={`badge text-xs ${
                          r.status === "OPEN"
                            ? "bg-amber-100 text-amber-800"
                            : r.status === "CHARGED"
                              ? "bg-blue-100 text-blue-800"
                              : r.status === "REPAIRED"
                                ? "bg-emerald-100 text-emerald-800"
                                : "bg-zinc-100 text-zinc-600"
                        }`}
                      >
                        {r.status}
                      </span>
                    </td>
                    <td className="text-right">
                      <ActionForm action={updateDamageStatusAction} className="inline-flex gap-1">
                        <input type="hidden" name="id" value={r.id} />
                        <select
                          name="status"
                          defaultValue={r.status}
                          className="input py-1 px-2 text-xs"
                        >
                          <option value="OPEN">Open</option>
                          <option value="CHARGED">Charged</option>
                          <option value="REPAIRED">Repaired</option>
                          <option value="WAIVED">Waived</option>
                        </select>
                        <SubmitButton className="btn-secondary text-xs py-1 px-2" pendingText="…">
                          Set
                        </SubmitButton>
                      </ActionForm>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
