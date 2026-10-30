import type { Metadata } from "next";
import { Suspense } from "react";
import { DriverForm } from "@/components/driver-form";
import { Field } from "@/components/ui/field";
import { ActionForm } from "@/components/rental-actions";
import { PageHeader, PageLoading } from "@/components/ui/states";
import { SubmitButton } from "@/components/ui/submit-button";
import { driverInitial } from "@/lib/driver-initial";
import { getDriverProfile } from "@/server/data/drivers";
import { requireUser } from "@/server/session";
import { saveDriverAction, updateAccountAction } from "./actions";

export const metadata: Metadata = { title: "Profile" };

export default function ProfilePage() {
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
      <PageHeader title="Profile" description="Your account and the driver details we need before every rental." />
      <Suspense fallback={<PageLoading />}>
        <ProfileContent />
      </Suspense>
    </div>
  );
}

async function ProfileContent() {
  const user = await requireUser("/profile");
  const profile = await getDriverProfile(user.id);
  const licence = profile?.licenceFileKey
    ? { url: `/api/files/licence/${profile.id}`, isPdf: profile.licenceFileKey.endsWith(".pdf") }
    : null;

  return (
    <div className="mt-6 space-y-6">
      <section className="card p-5 sm:p-6" aria-labelledby="account-title">
        <h2 id="account-title" className="text-lg font-semibold">
          Account
        </h2>
        <p className="text-sm text-muted">
          Signed in as <span className="font-medium text-ink">{user.email}</span>
          {user.role === "ADMIN" && <span className="badge ml-2 bg-brand-100 text-brand-800">Admin</span>}
        </p>
        <ActionForm action={updateAccountAction} className="mt-4 grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end" testId="account-form">
          <Field label="Name" name="name" required defaultValue={user.name} autoComplete="name" />
          <Field label="Contact phone" name="phone" type="tel" defaultValue={user.phone ?? ""} autoComplete="tel" />
          <SubmitButton className="btn-secondary" pendingText="Saving…">
            Save
          </SubmitButton>
        </ActionForm>
      </section>

      <section className="card p-5 sm:p-6" aria-labelledby="driver-title">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 id="driver-title" className="text-lg font-semibold">
            Driver &amp; licence
          </h2>
          {profile?.licenceVerifiedAt ? (
            <span className="badge bg-emerald-100 text-emerald-900" data-testid="licence-verified">
              Licence verified
            </span>
          ) : profile?.licenceFileKey ? (
            <span className="badge bg-amber-100 text-amber-900">Licence awaiting check at pick-up</span>
          ) : (
            <span className="badge bg-zinc-100 text-zinc-700">No licence on file</span>
          )}
        </div>
        {licence && !licence.isPdf && (
          // eslint-disable-next-line @next/next/no-img-element -- private, auth-checked route
          <img src={licence.url} alt="Your uploaded driving licence" className="mb-4 max-h-48 rounded-lg border border-line object-contain" data-testid="licence-image" />
        )}
        <DriverForm action={saveDriverAction} initial={driverInitial(profile, user.name, user.phone)} licence={licence} hiddenFields={{ returnTo: "/profile" }} />
      </section>
    </div>
  );
}
