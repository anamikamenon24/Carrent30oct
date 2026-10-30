import type { DriverFormValues } from "@/components/driver-form";
import type { DriverProfile } from "@/server/data/drivers";

/** Initial driver-form values from a saved profile, or from the account name/phone. */
export function driverInitial(p: DriverProfile | null, fallbackName: string, fallbackPhone: string | null): Partial<DriverFormValues> {
  if (!p) {
    const [first = "", ...rest] = fallbackName.split(" ");
    return { firstName: first, lastName: rest.join(" "), phone: fallbackPhone ?? "" };
  }
  return {
    firstName: p.firstName,
    lastName: p.lastName,
    dateOfBirth: p.dateOfBirth,
    phone: p.phone,
    nationality: p.nationality ?? "",
    addressLine: p.addressLine ?? "",
    city: p.city ?? "",
    country: p.country ?? "",
    licenceNumber: p.licenceNumber,
    licenceCountry: p.licenceCountry,
    licenceIssuedOn: p.licenceIssuedOn ?? "",
    licenceExpiresOn: p.licenceExpiresOn,
  };
}
