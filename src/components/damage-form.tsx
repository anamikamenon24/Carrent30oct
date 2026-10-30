"use client";

import { ActionForm, type RentalActionState } from "@/components/rental-actions";
import { Field, SelectField, TextAreaField } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";

/** New damage report with photo upload. Pass a fixed vehicle/reservation, or let staff pick. */
export function DamageForm({
  action,
  vehicleId,
  reservationId,
  vehicles,
  defaultStage = "OTHER",
  allowCharge,
}: {
  action: (s: RentalActionState, f: FormData) => Promise<RentalActionState>;
  vehicleId?: string;
  reservationId?: string;
  vehicles?: { id: string; label: string }[];
  defaultStage?: "PICKUP" | "RETURN" | "OTHER";
  allowCharge?: boolean;
}) {
  return (
    <ActionForm action={action} className="grid gap-4 sm:grid-cols-2" testId="damage-form">
      {vehicleId && <input type="hidden" name="vehicleId" value={vehicleId} />}
      {reservationId && <input type="hidden" name="reservationId" value={reservationId} />}
      {!vehicleId && vehicles && (
        <SelectField label="Vehicle" name="vehicleId" required defaultValue="">
          <option value="" disabled>
            Choose a vehicle…
          </option>
          {vehicles.map((v) => (
            <option key={v.id} value={v.id}>
              {v.label}
            </option>
          ))}
        </SelectField>
      )}
      {!reservationId && <Field label="Reservation reference (optional)" name="reservationRef" placeholder="DE-XXXXXXXX" />}
      <SelectField label="Stage" name="stage" defaultValue={defaultStage}>
        <option value="PICKUP">At pick-up</option>
        <option value="RETURN">At return</option>
        <option value="OTHER">Other</option>
      </SelectField>
      <SelectField label="Severity" name="severity" defaultValue="MINOR">
        <option value="MINOR">Minor</option>
        <option value="MODERATE">Moderate</option>
        <option value="MAJOR">Major</option>
      </SelectField>
      <Field label="Location on car" name="location" placeholder="e.g. Rear bumper, left" />
      <Field label="Estimated repair cost (AED)" name="estimatedCost" type="number" min={0} step="0.01" />
      {allowCharge && (
        <Field label="Charge to renter (AED, before VAT)" name="charge" type="number" min={0} step="0.01" hint="Billed against the deposit at check-in." />
      )}
      <TextAreaField label="Description" name="description" required className="sm:col-span-2" />
      <div className="sm:col-span-2">
        <Field
          label="Photos"
          name="images"
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp"
          hint="Up to 12 photos, 8 MB each. Visible to staff only."
          testId="damage-images"
        />
      </div>
      <div className="sm:col-span-2">
        <SubmitButton pendingText="Saving report…" testId="damage-submit">
          Save damage report
        </SubmitButton>
      </div>
    </ActionForm>
  );
}
