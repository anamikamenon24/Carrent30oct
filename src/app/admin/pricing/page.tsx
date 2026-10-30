import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { ActionForm } from "@/components/rental-actions";
import { PageHeader, PageLoading } from "@/components/ui/states";
import { SubmitButton } from "@/components/ui/submit-button";
import { formatAED } from "@/lib/format";
import { listBranches, listCategories, listExtras, listPricingRules } from "@/server/data/catalog";
import { requireAdmin } from "@/server/session";
import {
  deletePricingRuleAction,
  saveExtraAction,
  savePricingRuleAction,
  updateCategoryAction,
} from "../actions";

export const metadata: Metadata = { title: "Pricing & Extras · Admin" };

export default function AdminPricingPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Pricing & Extras"
        description="Base category rates, seasonal surcharges, duration discounts, one-way fees, and rental extras."
      />
      <Suspense fallback={<PageLoading />}>
        <PricingContent />
      </Suspense>
    </div>
  );
}

async function PricingContent() {
  await requireAdmin();
  await connection();
  const [categories, rules, extras, branches] = await Promise.all([
    listCategories(),
    listPricingRules(),
    listExtras({ includeInactive: true }),
    listBranches({ includeInactive: true }),
  ]);

  const seasonalRules = rules.filter((r) => r.type === "SEASONAL");
  const durationRules = rules.filter((r) => r.type === "DURATION_DISCOUNT");
  const oneWayRules = rules.filter((r) => r.type === "ONE_WAY_FEE");
  const branchMap = new Map(branches.map((b) => [b.id, b.name]));
  const catMap = new Map(categories.map((c) => [c.id, c.name]));

  return (
    <div className="space-y-8">
      {/* 1. Category Rates & Deposits */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-ink">Category Base Rates & Deposits</h2>
          <p className="text-sm text-muted">Set standard daily rate and security deposit hold per vehicle category.</p>
        </div>
        <div className="card overflow-x-auto">
          <table className="table min-w-[45rem]">
            <thead>
              <tr>
                <th>Category</th>
                <th>Min Age</th>
                <th>Daily Rate (AED)</th>
                <th>Deposit Hold (AED)</th>
                <th className="text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {categories.map((c) => (
                <tr key={c.id}>
                  <td className="font-medium text-ink">
                    {c.name}
                    <span className="block font-mono text-xs text-muted">{c.code}</span>
                  </td>
                  <td>{c.minDriverAge} yrs</td>
                  <td colSpan={3}>
                    <ActionForm action={updateCategoryAction} className="flex items-center gap-3">
                      <input type="hidden" name="id" value={c.id} />
                      <input type="hidden" name="name" value={c.name} />
                      <input type="hidden" name="minDriverAge" value={c.minDriverAge} />
                      <div className="w-32">
                        <input
                          name="dailyRate"
                          defaultValue={(c.dailyRateFils / 100).toFixed(2)}
                          className="input py-1 text-sm font-mono tabular-nums"
                          placeholder="Rate"
                        />
                      </div>
                      <div className="w-32">
                        <input
                          name="deposit"
                          defaultValue={(c.depositFils / 100).toFixed(2)}
                          className="input py-1 text-sm font-mono tabular-nums"
                          placeholder="Deposit"
                        />
                      </div>
                      <div className="ml-auto">
                        <SubmitButton className="btn-secondary text-xs" pendingText="Saving…">
                          Save
                        </SubmitButton>
                      </div>
                    </ActionForm>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* 2. Seasonal Surcharges & Discounts */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-ink">Seasonal Rules</h2>
          <p className="text-sm text-muted">Adjust daily rates by percentage for peak or off-peak date ranges.</p>
        </div>
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 card overflow-x-auto">
            {seasonalRules.length === 0 ? (
              <p className="p-4 text-sm text-muted">No seasonal rules defined.</p>
            ) : (
              <table className="table min-w-[30rem]">
                <thead>
                  <tr>
                    <th>Rule</th>
                    <th>Dates</th>
                    <th>Adjustment</th>
                    <th>Scope</th>
                    <th className="text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {seasonalRules.map((r) => {
                    const pct = r.adjustmentBps ? (r.adjustmentBps / 100).toFixed(1) : "0";
                    const isPositive = Number(pct) >= 0;
                    return (
                      <tr key={r.id}>
                        <td className="font-medium text-ink">{r.name}</td>
                        <td className="text-xs font-mono">
                          {r.validFrom} to {r.validTo}
                        </td>
                        <td>
                          <span
                            className={`badge ${isPositive ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}`}
                          >
                            {isPositive ? `+${pct}%` : `${pct}%`}
                          </span>
                        </td>
                        <td className="text-xs text-muted">{r.categoryId ? catMap.get(r.categoryId) : "All Categories"}</td>
                        <td className="text-right">
                          <ActionForm action={deletePricingRuleAction}>
                            <input type="hidden" name="id" value={r.id} />
                            <SubmitButton className="btn-danger text-xs py-1 px-2" pendingText="…">
                              Delete
                            </SubmitButton>
                          </ActionForm>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
          {/* Add Seasonal Rule Form */}
          <ActionForm action={savePricingRuleAction} className="card p-4 space-y-3">
            <h3 className="font-medium text-sm text-ink">Add Seasonal Rule</h3>
            <input type="hidden" name="type" value="SEASONAL" />
            <div>
              <label className="label text-xs">Rule Name</label>
              <input name="name" required placeholder="Summer Peak" className="input text-sm py-1.5" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label text-xs">Valid From</label>
                <input name="validFrom" type="date" required className="input text-sm py-1.5" />
              </div>
              <div>
                <label className="label text-xs">Valid To</label>
                <input name="validTo" type="date" required className="input text-sm py-1.5" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label text-xs">Adjustment %</label>
                <input name="adjustmentPct" type="number" step="0.1" required placeholder="20" className="input text-sm py-1.5" />
              </div>
              <div>
                <label className="label text-xs">Category</label>
                <select name="categoryId" className="input text-sm py-1.5">
                  <option value="">All Categories</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <input type="checkbox" name="isActive" defaultChecked id="sr-active" className="h-4 w-4 rounded text-brand-600" />
              <label htmlFor="sr-active" className="text-xs cursor-pointer">
                Active
              </label>
            </div>
            <SubmitButton className="btn-primary w-full text-sm mt-2" pendingText="Adding…">
              Add Seasonal Rule
            </SubmitButton>
          </ActionForm>
        </div>
      </section>

      {/* 3. Duration Discounts */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-ink">Duration Discounts</h2>
          <p className="text-sm text-muted">Automatic percentage discounts for longer rental periods.</p>
        </div>
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 card overflow-x-auto">
            {durationRules.length === 0 ? (
              <p className="p-4 text-sm text-muted">No duration discounts configured.</p>
            ) : (
              <table className="table min-w-[30rem]">
                <thead>
                  <tr>
                    <th>Rule</th>
                    <th>Min Days</th>
                    <th>Discount</th>
                    <th>Scope</th>
                    <th className="text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {durationRules.map((r) => {
                    const pct = r.adjustmentBps ? Math.abs(r.adjustmentBps / 100).toFixed(1) : "0";
                    return (
                      <tr key={r.id}>
                        <td className="font-medium text-ink">{r.name}</td>
                        <td className="tabular-nums">{r.minDays} days</td>
                        <td>
                          <span className="badge bg-green-100 text-green-800">-{pct}%</span>
                        </td>
                        <td className="text-xs text-muted">{r.categoryId ? catMap.get(r.categoryId) : "All Categories"}</td>
                        <td className="text-right">
                          <ActionForm action={deletePricingRuleAction}>
                            <input type="hidden" name="id" value={r.id} />
                            <SubmitButton className="btn-danger text-xs py-1 px-2" pendingText="…">
                              Delete
                            </SubmitButton>
                          </ActionForm>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
          {/* Add Duration Discount Form */}
          <ActionForm action={savePricingRuleAction} className="card p-4 space-y-3">
            <h3 className="font-medium text-sm text-ink">Add Duration Discount</h3>
            <input type="hidden" name="type" value="DURATION_DISCOUNT" />
            <div>
              <label className="label text-xs">Rule Name</label>
              <input name="name" required placeholder="Weekly Discount" className="input text-sm py-1.5" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label text-xs">Min Days</label>
                <input name="minDays" type="number" min="2" required placeholder="7" className="input text-sm py-1.5" />
              </div>
              <div>
                <label className="label text-xs">Discount %</label>
                <input name="adjustmentPct" type="number" min="1" max="90" required placeholder="10" className="input text-sm py-1.5" />
              </div>
            </div>
            <div>
              <label className="label text-xs">Category</label>
              <select name="categoryId" className="input text-sm py-1.5">
                <option value="">All Categories</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <input type="checkbox" name="isActive" defaultChecked id="dd-active" className="h-4 w-4 rounded text-brand-600" />
              <label htmlFor="dd-active" className="text-xs cursor-pointer">
                Active
              </label>
            </div>
            <SubmitButton className="btn-primary w-full text-sm mt-2" pendingText="Adding…">
              Add Discount
            </SubmitButton>
          </ActionForm>
        </div>
      </section>

      {/* 4. One-Way Fees */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-ink">One-Way Fees</h2>
          <p className="text-sm text-muted">Fees applied when the return branch differs from the pickup branch.</p>
        </div>
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 card overflow-x-auto">
            {oneWayRules.length === 0 ? (
              <p className="p-4 text-sm text-muted">No specific one-way fee rules defined.</p>
            ) : (
              <table className="table min-w-[30rem]">
                <thead>
                  <tr>
                    <th>Rule</th>
                    <th>Route</th>
                    <th>Fee (AED)</th>
                    <th>Category</th>
                    <th className="text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {oneWayRules.map((r) => (
                    <tr key={r.id}>
                      <td className="font-medium text-ink">{r.name}</td>
                      <td className="text-xs">
                        {r.pickupBranchId ? branchMap.get(r.pickupBranchId) : "Any"}
                        {" → "}
                        {r.returnBranchId ? branchMap.get(r.returnBranchId) : "Any"}
                      </td>
                      <td className="tabular-nums font-mono">{formatAED(r.amountFils ?? 0)}</td>
                      <td className="text-xs text-muted">{r.categoryId ? catMap.get(r.categoryId) : "All"}</td>
                      <td className="text-right">
                        <ActionForm action={deletePricingRuleAction}>
                          <input type="hidden" name="id" value={r.id} />
                          <SubmitButton className="btn-danger text-xs py-1 px-2" pendingText="…">
                            Delete
                          </SubmitButton>
                        </ActionForm>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {/* Add One-Way Fee Form */}
          <ActionForm action={savePricingRuleAction} className="card p-4 space-y-3">
            <h3 className="font-medium text-sm text-ink">Add One-Way Fee</h3>
            <input type="hidden" name="type" value="ONE_WAY_FEE" />
            <div>
              <label className="label text-xs">Rule Name</label>
              <input name="name" required placeholder="Dubai to Abu Dhabi Fee" className="input text-sm py-1.5" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label text-xs">Pickup Branch</label>
                <select name="pickupBranchId" className="input text-sm py-1.5">
                  <option value="">Any Branch</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label text-xs">Return Branch</label>
                <select name="returnBranchId" className="input text-sm py-1.5">
                  <option value="">Any Branch</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label text-xs">Fee (AED)</label>
                <input name="amount" type="number" step="1" required placeholder="150" className="input text-sm py-1.5" />
              </div>
              <div>
                <label className="label text-xs">Category</label>
                <select name="categoryId" className="input text-sm py-1.5">
                  <option value="">All Categories</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <input type="checkbox" name="isActive" defaultChecked id="ow-active" className="h-4 w-4 rounded text-brand-600" />
              <label htmlFor="ow-active" className="text-xs cursor-pointer">
                Active
              </label>
            </div>
            <SubmitButton className="btn-primary w-full text-sm mt-2" pendingText="Adding…">
              Add Fee
            </SubmitButton>
          </ActionForm>
        </div>
      </section>

      {/* 5. Extras */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-ink">Extras & Add-ons</h2>
          <p className="text-sm text-muted">Manage available booking add-ons (child seats, GPS, insurance cover).</p>
        </div>
        <div className="card overflow-x-auto">
          <table className="table min-w-[45rem]">
            <thead>
              <tr>
                <th>Code</th>
                <th>Name & Description</th>
                <th>Pricing Model</th>
                <th>Price (AED)</th>
                <th>Max Qty</th>
                <th>Status</th>
                <th className="text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {extras.map((x) => (
                <tr key={x.id}>
                  <td className="font-mono font-semibold text-brand-700">{x.code}</td>
                  <td>
                    <p className="font-medium text-ink">{x.name}</p>
                    {x.description && <p className="text-xs text-muted truncate max-w-xs">{x.description}</p>}
                  </td>
                  <td>
                    <span className="badge bg-zinc-100 text-zinc-800">
                      {x.pricing === "PER_DAY" ? "Per Day" : "Per Rental"}
                    </span>
                  </td>
                  <td className="font-mono tabular-nums font-semibold">{formatAED(x.priceFils)}</td>
                  <td className="tabular-nums">{x.maxQuantity}</td>
                  <td>
                    {x.isActive ? (
                      <span className="badge bg-emerald-100 text-emerald-800">Active</span>
                    ) : (
                      <span className="badge bg-zinc-100 text-zinc-600">Inactive</span>
                    )}
                  </td>
                  <td className="text-right">
                    <ActionForm action={saveExtraAction} className="inline-block">
                      <input type="hidden" name="id" value={x.id} />
                      <input type="hidden" name="code" value={x.code} />
                      <input type="hidden" name="name" value={x.name} />
                      <input type="hidden" name="description" value={x.description ?? ""} />
                      <input type="hidden" name="pricing" value={x.pricing} />
                      <input type="hidden" name="price" value={(x.priceFils / 100).toFixed(2)} />
                      <input type="hidden" name="maxQuantity" value={x.maxQuantity} />
                      <input type="hidden" name="isActive" value={x.isActive ? "false" : "true"} />
                      <SubmitButton className="btn-secondary text-xs" pendingText="…">
                        {x.isActive ? "Disable" : "Enable"}
                      </SubmitButton>
                    </ActionForm>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
