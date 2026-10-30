import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm } from "@/components/rental-actions";
import { PageHeader } from "@/components/ui/states";
import { SubmitButton } from "@/components/ui/submit-button";
import { requireAdmin } from "@/server/session";
import { createBranchAction } from "../../actions";

export const metadata: Metadata = { title: "Add Branch · Admin" };

export default async function NewBranchPage() {
  await requireAdmin();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Add branch"
        description="Register a new branch location for vehicle pickups and returns."
        actions={
          <Link href="/admin/branches" className="btn-secondary">
            Cancel
          </Link>
        }
      />
      <ActionForm action={createBranchAction} className="card space-y-6 p-6" testId="new-branch-form">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="code" className="label">
              Branch code *
            </label>
            <input
              id="code"
              name="code"
              required
              placeholder="e.g. DXB-APT"
              className="input font-mono uppercase"
              maxLength={16}
            />
            <p className="mt-1 text-xs text-muted">2–16 uppercase letters, digits or dashes.</p>
          </div>
          <div>
            <label htmlFor="name" className="label">
              Branch name *
            </label>
            <input id="name" name="name" required placeholder="Dubai International Airport T3" className="input" />
          </div>
          <div>
            <label htmlFor="city" className="label">
              City *
            </label>
            <input id="city" name="city" required placeholder="Dubai" className="input" />
          </div>
          <div>
            <label htmlFor="emirate" className="label">
              Emirate *
            </label>
            <input id="emirate" name="emirate" required placeholder="Dubai" className="input" />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="addressLine" className="label">
              Address *
            </label>
            <input
              id="addressLine"
              name="addressLine"
              required
              placeholder="Arrivals Hall, Terminal 3, Airport Road"
              className="input"
            />
          </div>
          <div>
            <label htmlFor="phone" className="label">
              Phone
            </label>
            <input id="phone" name="phone" type="tel" placeholder="+971 4 123 4567" className="input" />
          </div>
          <div>
            <label htmlFor="email" className="label">
              Email
            </label>
            <input id="email" name="email" type="email" placeholder="dxb@driveeasy.ae" className="input" />
          </div>
          <div>
            <label htmlFor="timeZone" className="label">
              Time zone
            </label>
            <input id="timeZone" name="timeZone" defaultValue="Asia/Dubai" className="input font-mono text-sm" />
          </div>
          <div>
            <label htmlFor="opensAt" className="label">
              Opening time
            </label>
            <input id="opensAt" name="opensAt" defaultValue="08:00" className="input" placeholder="08:00" />
          </div>
          <div>
            <label htmlFor="closesAt" className="label">
              Closing time
            </label>
            <input id="closesAt" name="closesAt" defaultValue="22:00" className="input" placeholder="22:00" />
          </div>
          <div>
            <label htmlFor="latitude" className="label">
              Latitude
            </label>
            <input id="latitude" name="latitude" type="number" step="any" placeholder="25.2532" className="input" />
          </div>
          <div>
            <label htmlFor="longitude" className="label">
              Longitude
            </label>
            <input id="longitude" name="longitude" type="number" step="any" placeholder="55.3657" className="input" />
          </div>
        </div>

        <div className="flex flex-wrap gap-6 pt-2 border-t border-line">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" name="is24Hours" className="h-4 w-4 rounded text-brand-600" />
            <span>Open 24 hours</span>
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" name="isActive" defaultChecked className="h-4 w-4 rounded text-brand-600" />
            <span>Active (available for bookings)</span>
          </label>
        </div>

        <div className="flex justify-end gap-3 pt-4 border-t border-line">
          <Link href="/admin/branches" className="btn-secondary">
            Cancel
          </Link>
          <SubmitButton className="btn-primary" pendingText="Saving…">
            Create branch
          </SubmitButton>
        </div>
      </ActionForm>
    </div>
  );
}
