import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/rental-actions";
import { PageHeader } from "@/components/ui/states";
import { SubmitButton } from "@/components/ui/submit-button";
import { getBranch } from "@/server/data/catalog";
import { requireAdmin } from "@/server/session";
import { updateBranchAction } from "../../actions";

export const metadata: Metadata = { title: "Edit Branch · Admin" };

export default async function EditBranchPage({ params, searchParams }: PageProps<"/admin/branches/[id]">) {
  await requireAdmin();
  const { id } = await params;
  const sp = await searchParams;
  const branch = await getBranch(id);

  if (!branch) {
    notFound();
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title={`Edit: ${branch.name}`}
        description={`Code: ${branch.code} · ${branch.city}, ${branch.emirate}`}
        actions={
          <div className="flex gap-2">
            <Link href={`/branches/${branch.code.toLowerCase()}`} className="btn-secondary" target="_blank">
              View public page
            </Link>
            <Link href="/admin/branches" className="btn-secondary">
              Back to branches
            </Link>
          </div>
        }
      />
      {sp?.saved && (
        <div className="rounded-lg bg-emerald-50 p-4 text-sm text-emerald-800 border border-emerald-200">
          Branch details saved successfully.
        </div>
      )}
      <ActionForm action={updateBranchAction} className="card space-y-6 p-6" testId="edit-branch-form">
        <input type="hidden" name="id" value={branch.id} />
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="code" className="label">
              Branch code *
            </label>
            <input
              id="code"
              name="code"
              required
              defaultValue={branch.code}
              className="input font-mono uppercase"
              maxLength={16}
            />
          </div>
          <div>
            <label htmlFor="name" className="label">
              Branch name *
            </label>
            <input id="name" name="name" required defaultValue={branch.name} className="input" />
          </div>
          <div>
            <label htmlFor="city" className="label">
              City *
            </label>
            <input id="city" name="city" required defaultValue={branch.city} className="input" />
          </div>
          <div>
            <label htmlFor="emirate" className="label">
              Emirate *
            </label>
            <input id="emirate" name="emirate" required defaultValue={branch.emirate} className="input" />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="addressLine" className="label">
              Address *
            </label>
            <input id="addressLine" name="addressLine" required defaultValue={branch.addressLine} className="input" />
          </div>
          <div>
            <label htmlFor="phone" className="label">
              Phone
            </label>
            <input id="phone" name="phone" type="tel" defaultValue={branch.phone ?? ""} className="input" />
          </div>
          <div>
            <label htmlFor="email" className="label">
              Email
            </label>
            <input id="email" name="email" type="email" defaultValue={branch.email ?? ""} className="input" />
          </div>
          <div>
            <label htmlFor="timeZone" className="label">
              Time zone
            </label>
            <input id="timeZone" name="timeZone" defaultValue={branch.timeZone} className="input font-mono text-sm" />
          </div>
          <div>
            <label htmlFor="opensAt" className="label">
              Opening time
            </label>
            <input id="opensAt" name="opensAt" defaultValue={branch.opensAt} className="input" />
          </div>
          <div>
            <label htmlFor="closesAt" className="label">
              Closing time
            </label>
            <input id="closesAt" name="closesAt" defaultValue={branch.closesAt} className="input" />
          </div>
          <div>
            <label htmlFor="latitude" className="label">
              Latitude
            </label>
            <input
              id="latitude"
              name="latitude"
              type="number"
              step="any"
              defaultValue={branch.latitude ?? ""}
              className="input"
            />
          </div>
          <div>
            <label htmlFor="longitude" className="label">
              Longitude
            </label>
            <input
              id="longitude"
              name="longitude"
              type="number"
              step="any"
              defaultValue={branch.longitude ?? ""}
              className="input"
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-6 pt-2 border-t border-line">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              name="is24Hours"
              defaultChecked={branch.is24Hours}
              className="h-4 w-4 rounded text-brand-600"
            />
            <span>Open 24 hours</span>
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              name="isActive"
              defaultChecked={branch.isActive}
              className="h-4 w-4 rounded text-brand-600"
            />
            <span>Active (available for bookings)</span>
          </label>
        </div>

        <div className="flex justify-end gap-3 pt-4 border-t border-line">
          <Link href="/admin/branches" className="btn-secondary">
            Cancel
          </Link>
          <SubmitButton className="btn-primary" pendingText="Saving…">
            Save changes
          </SubmitButton>
        </div>
      </ActionForm>
    </div>
  );
}
