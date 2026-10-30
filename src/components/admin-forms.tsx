"use client";

import { ActionForm, type RentalActionState } from "@/components/rental-actions";
import { Field, SelectField, TextAreaField } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";

type Action = (s: RentalActionState, f: FormData) => Promise<RentalActionState>;

const TIME_ZONES = ["Asia/Dubai", "Asia/Muscat", "Asia/Riyadh", "Asia/Qatar", "Asia/Bahrain", "Asia/Kuwait"];

export interface BranchFormValues {
  id?: string;
  code?: string;
  name?: string;
  city?: string;
  emirate?: string;
  addressLine?: string;
  phone?: string | null;
  email?: string | null;
  timeZone?: string;
  latitude?: number | null;
  longitude?: number | null;
  opensAt?: string;
  closesAt?: string;
  is24Hours?: boolean;
  isActive?: boolean;
}

export function BranchForm({ action, initial = {}, submitLabel }: { action: Action; initial?: BranchFormValues; submitLabel: string }) {
  return (
    <ActionForm action={action} className="grid gap-4 sm:grid-cols-2" testId="branch-form">
      {initial.id && <input type="hidden" name="id" value={initial.id} />}
      <Field label="Code" name="code" required defaultValue={initial.code} placeholder="DXB-APT" pattern="[A-Za-z0-9-]{2,20}" hint="Letters, digits and dashes." />
      <Field label="Name" name="name" required defaultValue={initial.name} />
      <Field label="City" name="city" required defaultValue={initial.city} />
      <Field label="Emirate" name="emirate" required defaultValue={initial.emirate} />
      <Field label="Address" name="addressLine" required defaultValue={initial.addressLine} className="sm:col-span-2" />
      <Field label="Phone" name="phone" type="tel" defaultValue={initial.phone ?? ""} />
      <Field label="Email" name="email" type="email" defaultValue={initial.email ?? ""} />
      <SelectField label="Time zone" name="timeZone" defaultValue={initial.timeZone ?? "Asia/Dubai"}>
        {Array.from(new Set([...(initial.timeZone ? [initial.timeZone] : []), ...TIME_ZONES])).map((tz) => (
          <option key={tz}>{tz}</option>
        ))}
      </SelectField>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Opens" name="opensAt" type="time" defaultValue={initial.opensAt?.slice(0, 5) ?? "08:00"} />
        <Field label="Closes" name="closesAt" type="time" defaultValue={initial.closesAt?.slice(0, 5) ?? "22:00"} />
      </div>
      <Field label="Latitude" name="latitude" type="number" step="0.000001" defaultValue={initial.latitude ?? ""} />
      <Field label="Longitude" name="longitude" type="number" step="0.000001" defaultValue={initial.longitude ?? ""} />
      <div className="flex flex-wrap gap-6 sm:col-span-2">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="is24Hours" defaultChecked={initial.is24Hours} className="size-4 accent-brand-600" /> Open 24 hours
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="isActive" defaultChecked={initial.isActive ?? true} className="size-4 accent-brand-600" /> Accepting bookings
        </label>
      </div>
      <div className="sm:col-span-2">
        <SubmitButton pendingText="Saving…" testId="branch-submit">
          {submitLabel}
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

export interface VehicleFormValues {
  id?: string;
  categoryId?: string;
  branchId?: string;
  plateNumber?: string;
  vin?: string;
  make?: string;
  model?: string;
  year?: number;
  color?: string | null;
  transmission?: string;
  fuelType?: string;
  seats?: number;
  doors?: number;
  luggage?: number;
  mileageKm?: number;
  dailyRateFils?: number | null;
  status?: string;
  description?: string | null;
  featureIds?: string[];
}

export function VehicleForm({
  action,
  initial = {},
  categories,
  branches,
  features,
  submitLabel,
}: {
  action: Action;
  initial?: VehicleFormValues;
  categories: { id: string; name: string }[];
  branches: { id: string; name: string }[];
  features: { id: string; name: string }[];
  submitLabel: string;
}) {
  return (
    <ActionForm action={action} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" testId="vehicle-form">
      {initial.id && <input type="hidden" name="id" value={initial.id} />}
      <Field label="Make" name="make" required defaultValue={initial.make} />
      <Field label="Model" name="model" required defaultValue={initial.model} />
      <Field label="Year" name="year" type="number" min={1990} max={2100} required defaultValue={initial.year} />
      <Field label="Plate number" name="plateNumber" required defaultValue={initial.plateNumber} />
      <Field label="VIN" name="vin" required minLength={11} maxLength={17} defaultValue={initial.vin} />
      <Field label="Colour" name="color" defaultValue={initial.color ?? ""} />
      <SelectField label="Category" name="categoryId" required defaultValue={initial.categoryId ?? ""}>
        <option value="" disabled>
          Choose…
        </option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </SelectField>
      <SelectField label="Home branch" name="branchId" required defaultValue={initial.branchId ?? ""}>
        <option value="" disabled>
          Choose…
        </option>
        {branches.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </SelectField>
      <SelectField label="Status" name="status" defaultValue={initial.status ?? "AVAILABLE"} testId="vehicle-status">
        <option value="AVAILABLE">Available</option>
        <option value="MAINTENANCE">Maintenance</option>
        <option value="RETIRED">Retired</option>
        {initial.status === "RESERVED" && <option value="RESERVED">Reserved (automatic)</option>}
        {initial.status === "ON_RENT" && <option value="ON_RENT">On rent (automatic)</option>}
      </SelectField>
      <SelectField label="Transmission" name="transmission" defaultValue={initial.transmission ?? "AUTOMATIC"}>
        <option value="AUTOMATIC">Automatic</option>
        <option value="MANUAL">Manual</option>
      </SelectField>
      <SelectField label="Fuel type" name="fuelType" defaultValue={initial.fuelType ?? "PETROL"}>
        <option value="PETROL">Petrol</option>
        <option value="DIESEL">Diesel</option>
        <option value="HYBRID">Hybrid</option>
        <option value="ELECTRIC">Electric</option>
      </SelectField>
      <Field label="Seats" name="seats" type="number" min={1} max={20} required defaultValue={initial.seats ?? 5} />
      <Field label="Doors" name="doors" type="number" min={1} max={6} defaultValue={initial.doors ?? 4} />
      <Field label="Luggage (bags)" name="luggage" type="number" min={0} max={20} defaultValue={initial.luggage ?? 2} />
      <Field label="Mileage (km)" name="mileageKm" type="number" min={0} defaultValue={initial.mileageKm ?? 0} />
      <Field
        label="Daily rate override (AED)"
        name="dailyRate"
        type="number"
        min={0}
        step="0.01"
        defaultValue={initial.dailyRateFils != null ? (initial.dailyRateFils / 100).toFixed(2) : ""}
        hint="Leave empty to use the category rate."
      />
      <TextAreaField label="Description" name="description" defaultValue={initial.description ?? ""} className="sm:col-span-2 lg:col-span-3" />
      {features.length > 0 && (
        <fieldset className="sm:col-span-2 lg:col-span-3">
          <legend className="label">Features</legend>
          <div className="flex flex-wrap gap-3">
            {features.map((f) => (
              <label key={f.id} className="flex items-center gap-2 rounded-lg border border-line px-3 py-1.5 text-sm">
                <input type="checkbox" name="featureIds" value={f.id} defaultChecked={initial.featureIds?.includes(f.id)} className="size-4 accent-brand-600" />
                {f.name}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <div className="sm:col-span-2 lg:col-span-3">
        <Field label="Add photos" name="photos" type="file" multiple accept="image/jpeg,image/png,image/webp" hint="JPG, PNG or WebP, up to 8 MB each. Shown publicly on the site." />
      </div>
      <div className="sm:col-span-2 lg:col-span-3">
        <SubmitButton pendingText="Saving…" testId="vehicle-submit">
          {submitLabel}
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

export function FuelSelect({ name = "fuelEighths", defaultValue = 8, label = "Fuel level" }: { name?: string; defaultValue?: number; label?: string }) {
  return (
    <SelectField label={label} name={name} defaultValue={String(defaultValue)} testId={name}>
      {Array.from({ length: 9 }, (_, i) => (
        <option key={i} value={i}>
          {i === 0 ? "Empty" : i === 8 ? "Full (8/8)" : `${i}/8`}
        </option>
      ))}
    </SelectField>
  );
}
