"use server";

import { redirect } from "next/navigation";
import { parseCriteria } from "@/lib/search-params";
import { localToUtc } from "@/lib/tz";
import { getBranch, listExtras } from "@/server/data/catalog";
import { isReservationError } from "@/server/reservations/errors";
import { createReservationHold } from "@/server/reservations/holds";
import { getCurrentUser } from "@/server/session";

export interface HoldState {
  error?: string;
}

/**
 * Creates the PENDING reservation (vehicle hold) from the extras page, then goes to checkout.
 * Everything is re-read from the form and re-priced on the server; the idempotency key makes
 * double-submits return the same reservation.
 */
export async function createHoldAction(_prev: HoldState, formData: FormData): Promise<HoldState> {
  const vehicleId = String(formData.get("vehicleId") ?? "");
  const returnTo = String(formData.get("returnTo") ?? "/");
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(returnTo.startsWith("/") ? returnTo : "/")}`);

  const sp = Object.fromEntries(["pickup", "dropoff", "start", "end"].map((k) => [k, String(formData.get(k) ?? "")]));
  const c = parseCriteria(sp);
  const [pickup, dropoff] = await Promise.all([getBranch(c.pickup ?? ""), getBranch(c.dropoff || c.pickup || "")]);
  if (!pickup || !dropoff || !c.start || !c.end) return { error: "Your trip details are incomplete. Go back and choose dates again." };

  const extras = await listExtras();
  const selected = extras.flatMap((x) => {
    const q = Number(formData.get(`qty_${x.code}`) ?? 0);
    return Number.isInteger(q) && q > 0 ? [{ extraId: x.id, quantity: Math.min(q, x.maxQuantity) }] : [];
  });

  let reservationId: string;
  try {
    const { reservation } = await createReservationHold({
      userId: user.id,
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      vehicleId,
      pickupBranchId: pickup.id,
      returnBranchId: dropoff.id,
      pickupAt: localToUtc(c.start, pickup.timeZone),
      returnAt: localToUtc(c.end, pickup.timeZone),
      extras: selected,
    });
    reservationId = reservation.id;
  } catch (err) {
    if (isReservationError(err)) return { error: err.message };
    console.error(JSON.stringify({ level: "error", msg: "create hold failed", vehicleId, err: String(err) }));
    return { error: "We couldn't reserve this car right now. Please try again." };
  }
  redirect(`/checkout/${reservationId}`);
}
