"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { auth } from "@/server/auth";
import type { DriverFormState, DriverFormValues } from "@/components/driver-form";
import { getDriverProfile, upsertDriverProfile } from "@/server/data/drivers";
import { storeUpload } from "@/server/files";
import { getStorage } from "@/server/services";
import { isReservationError } from "@/server/reservations/errors";
import { requireUser } from "@/server/session";

const FIELDS: (keyof DriverFormValues)[] = [
  "firstName",
  "lastName",
  "dateOfBirth",
  "phone",
  "nationality",
  "addressLine",
  "city",
  "country",
  "licenceNumber",
  "licenceCountry",
  "licenceIssuedOn",
  "licenceExpiresOn",
];

const REQUIRED: Partial<Record<keyof DriverFormValues, string>> = {
  firstName: "Enter the driver's first name",
  lastName: "Enter the driver's last name",
  dateOfBirth: "Enter the date of birth",
  phone: "Enter a phone number",
  licenceNumber: "Enter the licence number",
  licenceCountry: "Enter the country that issued the licence",
  licenceExpiresOn: "Enter the licence expiry date",
};

/** Saves driver details and (optionally) a new licence file for the signed-in user. */
export async function saveDriverAction(_prev: DriverFormState, formData: FormData): Promise<DriverFormState> {
  const returnTo = String(formData.get("returnTo") ?? "/profile");
  const user = await requireUser(returnTo.startsWith("/") ? returnTo : "/profile");
  const values = Object.fromEntries(FIELDS.map((f) => [f, String(formData.get(f) ?? "").trim()])) as unknown as DriverFormValues;

  const fieldErrors: DriverFormState["fieldErrors"] = {};
  for (const [k, msg] of Object.entries(REQUIRED)) {
    if (!values[k as keyof DriverFormValues]) fieldErrors[k as keyof DriverFormValues] = msg;
  }

  const existing = await getDriverProfile(user.id);
  const file = formData.get("licenceFile");
  const hasFile = file instanceof File && file.size > 0;
  if (!hasFile && !existing?.licenceFileKey) fieldErrors.licenceFile = "Upload a photo or PDF of your driving licence";
  if (Object.keys(fieldErrors).length) return { error: "Please fix the highlighted fields.", fieldErrors, values };

  let licenceFileKey: string | undefined;
  if (hasFile) {
    const stored = await storeUpload(file, `licences/${user.id}`, { allowPdf: true });
    if (!stored.ok) return { error: stored.error, fieldErrors: { licenceFile: stored.error }, values };
    licenceFileKey = stored.key;
  }

  try {
    await upsertDriverProfile(user.id, {
      ...values,
      nationality: values.nationality || null,
      addressLine: values.addressLine || null,
      city: values.city || null,
      country: values.country || null,
      licenceIssuedOn: values.licenceIssuedOn || null,
      licenceFileKey,
    });
  } catch (err) {
    if (isReservationError(err, "VALIDATION")) {
      const fields = (err.details?.fields ?? {}) as Record<string, string[] | undefined>;
      const fe: DriverFormState["fieldErrors"] = {};
      for (const [k, msgs] of Object.entries(fields)) if (msgs?.[0]) fe[k as keyof DriverFormValues] = msgs[0];
      return { error: err.message, fieldErrors: fe, values };
    }
    throw err;
  }
  if (licenceFileKey && existing?.licenceFileKey && existing.licenceFileKey !== licenceFileKey) {
    await getStorage().delete(existing.licenceFileKey).catch(() => undefined);
  }
  revalidatePath("/profile");
  revalidatePath(returnTo);
  return { ok: true, message: "Driver details saved.", values };
}

/** Updates the account name and contact phone (role and email are not editable here). */
export async function updateAccountAction(_prev: { error?: string; message?: string }, formData: FormData) {
  await requireUser("/profile");
  const name = String(formData.get("name") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  if (name.length < 2 || name.length > 100) return { error: "Enter your full name." };
  if (phone && !/^\+?[0-9 ()-]{5,30}$/.test(phone)) return { error: "Enter a valid phone number." };
  await auth.api.updateUser({ body: { name, phone: phone || null }, headers: await headers() });
  revalidatePath("/", "layout");
  return { message: "Account updated." };
}
