"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { RentalActionState } from "@/components/rental-actions";
import { parseAEDToFils } from "@/lib/format";
import { isLocalDateTime, localToUtc } from "@/lib/tz";
import {
  createBranch,
  createMaintenanceBlock,
  createVehicle,
  deleteMaintenanceBlock,
  deletePricingRule,
  saveExtra,
  savePricingRule,
  setVehicleStatus,
  updateBranch,
  updateCategory,
  updateVehicle,
  type PricingRuleInput,
} from "@/server/data/admin";
import { getBranch, getVehicle } from "@/server/data/catalog";
import { verifyDriverLicence } from "@/server/data/drivers";
import { storeUpload } from "@/server/files";
import { cancelReservation } from "@/server/reservations/changes";
import { isReservationError } from "@/server/reservations/errors";
import { checkIn, checkOut, createDamageReport, updateDamageReportStatus } from "@/server/reservations/operations";
import { getReservationDetail } from "@/server/reservations/queries";
import { requireAdmin } from "@/server/session";

type State = RentalActionState;

// ---------- form helpers ----------
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const optStr = (f: FormData, k: string) => str(f, k) || null;
const bool = (f: FormData, k: string) => f.get(k) === "on" || f.get(k) === "true";
function int(f: FormData, k: string): number | undefined {
  const v = str(f, k);
  if (v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : NaN;
}
function optNum(f: FormData, k: string): number | null {
  const v = str(f, k);
  if (v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}
/** AED text field -> fils; undefined if empty, NaN if invalid. */
function aed(f: FormData, k: string): number | undefined {
  const v = str(f, k);
  if (v === "") return undefined;
  return parseAEDToFils(v) ?? NaN;
}
/** Percentage text ("-10", "15.5") -> basis points. */
function pctToBps(f: FormData, k: string): number | undefined {
  const v = str(f, k);
  if (v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
}

/** Runs an admin mutation: checks the role, maps domain errors to a message, logs the rest. */
async function run(label: string, fn: (adminId: string) => Promise<State | void>): Promise<State> {
  const admin = await requireAdmin();
  try {
    return (await fn(admin.id)) ?? { message: "Saved." };
  } catch (err) {
    if (isReservationError(err)) {
      const fields = (err.details?.fields ?? {}) as Record<string, string[] | undefined>;
      const detail = Object.entries(fields)
        .filter(([, m]) => m?.length)
        .map(([k, m]) => `${k}: ${m![0]}`)
        .join("; ");
      return { error: detail ? `${err.message} (${detail})` : err.message };
    }
    // redirect() and notFound() must propagate.
    if (err && typeof err === "object" && "digest" in err) throw err;
    console.error(JSON.stringify({ level: "error", msg: `admin ${label} failed`, err: String(err) }));
    return { error: "Something went wrong. Please try again." };
  }
}

// ---------- branches ----------
function branchFromForm(f: FormData) {
  return {
    code: str(f, "code"),
    name: str(f, "name"),
    city: str(f, "city"),
    emirate: str(f, "emirate"),
    addressLine: str(f, "addressLine"),
    phone: optStr(f, "phone"),
    email: optStr(f, "email"),
    timeZone: str(f, "timeZone") || "Asia/Dubai",
    latitude: optNum(f, "latitude"),
    longitude: optNum(f, "longitude"),
    opensAt: str(f, "opensAt") || "08:00",
    closesAt: str(f, "closesAt") || "22:00",
    is24Hours: bool(f, "is24Hours"),
    isActive: bool(f, "isActive"),
  };
}

export async function createBranchAction(_p: State, f: FormData): Promise<State> {
  let id = "";
  const res = await run("create branch", async (adminId) => {
    id = (await createBranch(adminId, branchFromForm(f))).id;
  });
  if (res.error) return res;
  revalidatePath("/admin/branches");
  revalidatePath("/branches");
  redirect(`/admin/branches/${id}?saved=1`);
}

export async function updateBranchAction(_p: State, f: FormData): Promise<State> {
  const id = str(f, "id");
  return run("update branch", async (adminId) => {
    await updateBranch(adminId, id, branchFromForm(f));
    revalidatePath("/admin/branches");
    revalidatePath("/branches");
    return { message: "Branch saved." };
  });
}

// ---------- vehicles ----------
async function uploadPhotos(f: FormData): Promise<{ keys: string[] } | { error: string }> {
  const files = f.getAll("photos").filter((x): x is File => x instanceof File && x.size > 0);
  const keys: string[] = [];
  for (const file of files.slice(0, 10)) {
    const r = await storeUpload(file, "vehicles");
    if (!r.ok) return { error: `${file.name}: ${r.error}` };
    keys.push(r.key);
  }
  return { keys };
}

function vehicleFromForm(f: FormData) {
  const rate = aed(f, "dailyRate");
  return {
    categoryId: str(f, "categoryId"),
    branchId: str(f, "branchId"),
    plateNumber: str(f, "plateNumber"),
    vin: str(f, "vin"),
    make: str(f, "make"),
    model: str(f, "model"),
    year: int(f, "year") ?? NaN,
    color: optStr(f, "color"),
    transmission: str(f, "transmission") as "AUTOMATIC" | "MANUAL",
    fuelType: str(f, "fuelType") as "PETROL" | "DIESEL" | "HYBRID" | "ELECTRIC",
    seats: int(f, "seats") ?? NaN,
    doors: int(f, "doors"),
    luggage: int(f, "luggage"),
    mileageKm: int(f, "mileageKm"),
    dailyRateFils: rate === undefined ? null : rate,
    description: optStr(f, "description"),
    featureIds: f.getAll("featureIds").map(String),
  };
}

export async function createVehicleAction(_p: State, f: FormData): Promise<State> {
  let id = "";
  const res = await run("create vehicle", async (adminId) => {
    const photos = await uploadPhotos(f);
    if ("error" in photos) return { error: photos.error };
    const v = await createVehicle(adminId, { ...vehicleFromForm(f), photos: photos.keys });
    const status = str(f, "status");
    if (status === "MAINTENANCE" || status === "RETIRED") await setVehicleStatus(adminId, v.id, status);
    id = v.id;
  });
  if (res.error) return res;
  revalidatePath("/admin/fleet");
  redirect(`/admin/fleet/${id}?saved=1`);
}

export async function updateVehicleAction(_p: State, f: FormData): Promise<State> {
  const id = str(f, "id");
  return run("update vehicle", async (adminId) => {
    const current = await getVehicle(id);
    if (!current) return { error: "Vehicle not found." };
    const photos = await uploadPhotos(f);
    if ("error" in photos) return { error: photos.error };
    await updateVehicle(adminId, id, { ...vehicleFromForm(f), photos: [...current.photos, ...photos.keys] });
    const status = str(f, "status");
    if ((status === "AVAILABLE" || status === "MAINTENANCE" || status === "RETIRED") && status !== current.status) {
      // RESERVED / ON_RENT are derived; "AVAILABLE" re-derives them.
      if (!(status === "AVAILABLE" && (current.status === "RESERVED" || current.status === "ON_RENT"))) {
        await setVehicleStatus(adminId, id, status);
      }
    }
    revalidatePath(`/admin/fleet/${id}`);
    revalidatePath("/admin/fleet");
    return { message: "Vehicle saved." };
  });
}

export async function removeVehiclePhotoAction(_p: State, f: FormData): Promise<State> {
  const id = str(f, "id");
  const photo = str(f, "photo");
  return run("remove photo", async (adminId) => {
    const current = await getVehicle(id);
    if (!current) return { error: "Vehicle not found." };
    await updateVehicle(adminId, id, { photos: current.photos.filter((p) => p !== photo) });
    revalidatePath(`/admin/fleet/${id}`);
    return { message: "Photo removed." };
  });
}

export async function createMaintenanceAction(_p: State, f: FormData): Promise<State> {
  const vehicleId = str(f, "vehicleId");
  return run("create maintenance", async (adminId) => {
    const v = await getVehicle(vehicleId);
    if (!v) return { error: "Vehicle not found." };
    const s = str(f, "startsAt");
    const e = str(f, "endsAt");
    if (!isLocalDateTime(s) || !isLocalDateTime(e)) return { error: "Enter a start and end date and time." };
    await createMaintenanceBlock(adminId, {
      vehicleId,
      startsAt: localToUtc(s, v.branch.timeZone),
      endsAt: localToUtc(e, v.branch.timeZone),
      reason: str(f, "reason"),
    });
    revalidatePath(`/admin/fleet/${vehicleId}`);
    return { message: "Maintenance block added." };
  });
}

export async function deleteMaintenanceAction(_p: State, f: FormData): Promise<State> {
  return run("delete maintenance", async (adminId) => {
    await deleteMaintenanceBlock(adminId, str(f, "id"));
    revalidatePath(`/admin/fleet/${str(f, "vehicleId")}`);
    return { message: "Maintenance block removed." };
  });
}

// ---------- pricing ----------
export async function updateCategoryAction(_p: State, f: FormData): Promise<State> {
  return run("update category", async (adminId) => {
    const daily = aed(f, "dailyRate");
    const deposit = aed(f, "deposit");
    await updateCategory(adminId, str(f, "id"), {
      name: str(f, "name"),
      dailyRateFils: daily ?? NaN,
      depositFils: deposit ?? NaN,
      minDriverAge: int(f, "minDriverAge"),
    });
    revalidatePath("/admin/pricing");
    return { message: "Category rates saved." };
  });
}

export async function savePricingRuleAction(_p: State, f: FormData): Promise<State> {
  return run("save pricing rule", async (adminId) => {
    const type = str(f, "type");
    const base = {
      name: str(f, "name"),
      categoryId: optStr(f, "categoryId"),
      priority: int(f, "priority") ?? 0,
      isActive: bool(f, "isActive"),
    };
    let input: PricingRuleInput;
    if (type === "SEASONAL") {
      input = { ...base, type, validFrom: str(f, "validFrom"), validTo: str(f, "validTo"), adjustmentBps: pctToBps(f, "adjustmentPct") ?? NaN };
    } else if (type === "DURATION_DISCOUNT") {
      input = { ...base, type, minDays: int(f, "minDays") ?? NaN, adjustmentBps: -Math.abs(pctToBps(f, "adjustmentPct") ?? NaN) };
    } else if (type === "ONE_WAY_FEE") {
      input = { ...base, type, pickupBranchId: optStr(f, "pickupBranchId"), returnBranchId: optStr(f, "returnBranchId"), amountFils: aed(f, "amount") ?? NaN };
    } else {
      return { error: "Choose a rule type." };
    }
    const id = str(f, "id") || undefined;
    await savePricingRule(adminId, input, id);
    revalidatePath("/admin/pricing");
    return { message: id ? "Rule saved." : "Rule added." };
  });
}

export async function deletePricingRuleAction(_p: State, f: FormData): Promise<State> {
  return run("delete pricing rule", async (adminId) => {
    await deletePricingRule(adminId, str(f, "id"));
    revalidatePath("/admin/pricing");
    return { message: "Rule deleted." };
  });
}

export async function saveExtraAction(_p: State, f: FormData): Promise<State> {
  return run("save extra", async (adminId) => {
    const id = str(f, "id") || undefined;
    await saveExtra(
      adminId,
      {
        code: str(f, "code"),
        name: str(f, "name"),
        description: optStr(f, "description"),
        pricing: str(f, "pricing") as "PER_DAY" | "PER_RENTAL",
        priceFils: aed(f, "price") ?? NaN,
        maxQuantity: int(f, "maxQuantity") ?? 1,
        isActive: bool(f, "isActive"),
        sortOrder: int(f, "sortOrder") ?? 0,
      },
      id,
    );
    revalidatePath("/admin/pricing");
    return { message: id ? "Extra saved." : "Extra added." };
  });
}

// ---------- reservations: check-out / check-in / cancel ----------
export async function checkOutAction(_p: State, f: FormData): Promise<State> {
  const reservationId = str(f, "reservationId");
  return run("check-out", async (adminId) => {
    const mileageKm = int(f, "mileageKm");
    if (mileageKm === undefined || Number.isNaN(mileageKm)) return { error: "Enter the odometer reading in km." };
    await checkOut({ reservationId, staffUserId: adminId, mileageKm, fuelEighths: int(f, "fuelEighths") ?? NaN, notes: str(f, "notes") || undefined });
    revalidatePath(`/admin/reservations/${reservationId}`);
    revalidatePath("/admin/reservations");
    return { message: "Car checked out. Agreement created." };
  });
}

export async function checkInAction(_p: State, f: FormData): Promise<State> {
  const reservationId = str(f, "reservationId");
  return run("check-in", async (adminId) => {
    const mileageKm = int(f, "mileageKm");
    if (mileageKm === undefined || Number.isNaN(mileageKm)) return { error: "Enter the odometer reading in km." };
    const res = await checkIn({
      reservationId,
      staffUserId: adminId,
      mileageKm,
      fuelEighths: int(f, "fuelEighths") ?? NaN,
      returnBranchId: optStr(f, "returnBranchId") ?? undefined,
      notes: str(f, "notes") || undefined,
    });
    revalidatePath(`/admin/reservations/${reservationId}`);
    revalidatePath("/admin/reservations");
    const c = res.charges;
    return {
      message:
        c.totalFils > 0
          ? `Car checked in. Return charges ${(c.totalFils / 100).toFixed(2)} AED incl. VAT; ${(c.capturedFromDepositFils / 100).toFixed(2)} AED taken from the deposit${c.outstandingFils > 0 ? `, ${(c.outstandingFils / 100).toFixed(2)} AED to collect at the counter` : ""}.`
          : "Car checked in. No extra charges; the deposit hold has been released.",
    };
  });
}

export async function adminCancelAction(_p: State, f: FormData): Promise<State> {
  const reservationId = str(f, "reservationId");
  return run("admin cancel", async (adminId) => {
    await cancelReservation({
      reservationId,
      actor: { userId: adminId, role: "ADMIN" },
      reason: str(f, "reason") || "Cancelled by staff",
      waiveFee: bool(f, "waiveFee"),
    });
    revalidatePath(`/admin/reservations/${reservationId}`);
    return { message: "Reservation cancelled." };
  });
}

export async function verifyLicenceAction(_p: State, f: FormData): Promise<State> {
  return run("verify licence", async (adminId) => {
    await verifyDriverLicence(str(f, "profileId"), adminId);
    revalidatePath(`/admin/reservations/${str(f, "reservationId")}`);
    return { message: "Licence marked as checked." };
  });
}

// ---------- damage ----------
export async function createDamageAction(_p: State, f: FormData): Promise<State> {
  return run("create damage report", async (adminId) => {
    const files = f.getAll("images").filter((x): x is File => x instanceof File && x.size > 0);
    if (files.length > 12) return { error: "Upload at most 12 photos." };
    let reservationId = optStr(f, "reservationId");
    let vehicleId = str(f, "vehicleId");
    const ref = str(f, "reservationRef");
    if (!reservationId && ref) {
      const d = await getReservationDetail(ref);
      if (!d) return { error: `No reservation with reference ${ref}.` };
      reservationId = d.reservation.id;
      vehicleId ||= d.reservation.vehicleId;
    }
    if (!vehicleId) return { error: "Choose the vehicle." };
    const keys: string[] = [];
    for (const file of files) {
      const r = await storeUpload(file, `damage/${vehicleId}`);
      if (!r.ok) return { error: `${file.name}: ${r.error}` };
      keys.push(r.key);
    }
    await createDamageReport({
      vehicleId,
      reservationId,
      staffUserId: adminId,
      stage: (str(f, "stage") || "OTHER") as "PICKUP" | "RETURN" | "OTHER",
      severity: (str(f, "severity") || "MINOR") as "MINOR" | "MODERATE" | "MAJOR",
      location: str(f, "location") || undefined,
      description: str(f, "description"),
      photoKeys: keys,
      estimatedCostFils: aed(f, "estimatedCost") ?? null,
      chargeFils: aed(f, "charge") ?? 0,
    });
    revalidatePath("/admin/damage");
    if (reservationId) revalidatePath(`/admin/reservations/${reservationId}`);
    return { message: "Damage report saved." };
  });
}

export async function updateDamageStatusAction(_p: State, f: FormData): Promise<State> {
  return run("update damage status", async (adminId) => {
    await updateDamageReportStatus(str(f, "id"), str(f, "status") as "OPEN" | "CHARGED" | "WAIVED" | "REPAIRED", adminId);
    revalidatePath("/admin/damage");
    return { message: "Status updated." };
  });
}

/** Quick lookup by reference or QR payload from the admin dashboard. */
export async function findReservationAction(_p: State, f: FormData): Promise<State> {
  await requireAdmin();
  const { verifyVoucherPayload } = await import("@/server/voucher");
  const raw = str(f, "q");
  if (!raw) return { error: "Enter a reference or scan a voucher." };
  let ref = raw;
  if (raw.startsWith("DRIVEEASY:")) {
    const v = verifyVoucherPayload(raw);
    if (!v) return { error: "This QR code is not a genuine DriveEasy voucher." };
    ref = v.reservationId;
  }
  const d = await getReservationDetail(ref);
  if (!d) return { error: `No reservation found for “${raw}”.` };
  redirect(`/admin/reservations/${d.reservation.id}`);
}

export async function branchExists(code: string) {
  await requireAdmin();
  return Boolean(await getBranch(code));
}
