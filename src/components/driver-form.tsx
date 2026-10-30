"use client";

import { useActionState } from "react";
import { Alert } from "@/components/ui/alert";
import { Field } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";

export interface DriverFormValues {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  phone: string;
  nationality: string;
  addressLine: string;
  city: string;
  country: string;
  licenceNumber: string;
  licenceCountry: string;
  licenceIssuedOn: string;
  licenceExpiresOn: string;
}

export interface DriverFormState {
  ok?: boolean;
  message?: string;
  error?: string;
  fieldErrors?: Partial<Record<keyof DriverFormValues | "licenceFile", string>>;
  values?: Partial<DriverFormValues>;
}

/** Driver details + driving-licence upload. Used on checkout and on the profile page. */
export function DriverForm({
  action,
  initial,
  licence,
  submitLabel = "Save driver details",
  hiddenFields = {},
}: {
  action: (state: DriverFormState, formData: FormData) => Promise<DriverFormState>;
  initial: Partial<DriverFormValues>;
  licence: { url: string; isPdf?: boolean } | null;
  submitLabel?: string;
  hiddenFields?: Record<string, string>;
}) {
  const [state, formAction] = useActionState(action, {});
  const v = { ...initial, ...state.values };
  const e = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="space-y-5" data-testid="driver-form" noValidate>
      {Object.entries(hiddenFields).map(([k, val]) => (
        <input key={k} type="hidden" name={k} value={val} />
      ))}
      {state.error && <Alert tone="error">{state.error}</Alert>}
      {state.ok && state.message && <Alert tone="success">{state.message}</Alert>}

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold text-muted uppercase">Driver</legend>
        <Field label="First name" name="firstName" autoComplete="given-name" required defaultValue={v.firstName} error={e.firstName} />
        <Field label="Last name" name="lastName" autoComplete="family-name" required defaultValue={v.lastName} error={e.lastName} />
        <Field label="Date of birth" name="dateOfBirth" type="date" autoComplete="bday" required defaultValue={v.dateOfBirth} error={e.dateOfBirth} />
        <Field label="Phone" name="phone" type="tel" autoComplete="tel" required placeholder="+971 50 123 4567" defaultValue={v.phone} error={e.phone} />
        <Field label="Nationality" name="nationality" autoComplete="country-name" defaultValue={v.nationality} error={e.nationality} />
        <Field label="Address" name="addressLine" autoComplete="street-address" defaultValue={v.addressLine} error={e.addressLine} />
        <Field label="City" name="city" autoComplete="address-level2" defaultValue={v.city} error={e.city} />
        <Field label="Country of residence" name="country" autoComplete="country-name" defaultValue={v.country} error={e.country} />
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold text-muted uppercase">Driving licence</legend>
        <Field label="Licence number" name="licenceNumber" required defaultValue={v.licenceNumber} error={e.licenceNumber} />
        <Field label="Licence country" name="licenceCountry" required placeholder="United Arab Emirates" defaultValue={v.licenceCountry} error={e.licenceCountry} />
        <Field label="Licence issue date" name="licenceIssuedOn" type="date" defaultValue={v.licenceIssuedOn} error={e.licenceIssuedOn} />
        <Field label="Licence expiry" name="licenceExpiresOn" type="date" required defaultValue={v.licenceExpiresOn} error={e.licenceExpiresOn} />
        <div className="sm:col-span-2">
          <Field
            label="Driving licence (photo or PDF)"
            name="licenceFile"
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            required={!licence}
            hint={licence ? "Upload a new file only if you want to replace the one on file. Max 8 MB." : "JPG, PNG, WebP or PDF, max 8 MB. Only you and DriveEasy staff can see it."}
            error={e.licenceFile}
            testId="licence-upload"
            className="[&_input]:file:mr-3 [&_input]:file:rounded-md [&_input]:file:border-0 [&_input]:file:bg-brand-50 [&_input]:file:px-3 [&_input]:file:py-1 [&_input]:file:text-brand-800"
          />
          {licence && (
            <p className="mt-2 text-sm">
              Licence on file:{" "}
              <a href={licence.url} target="_blank" rel="noopener" className="font-medium text-brand-700 hover:underline" data-testid="licence-link">
                view uploaded licence
              </a>
            </p>
          )}
        </div>
      </fieldset>

      <SubmitButton pendingText="Saving…" testId="driver-submit">
        {submitLabel}
      </SubmitButton>
    </form>
  );
}
