"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { RentalActionState } from "@/components/rental-actions";
import { isLocalDateTime, localToUtc } from "@/lib/tz";
import { cancelReservation, modifyReservation } from "@/server/reservations/changes";
import { isReservationError } from "@/server/reservations/errors";
import { getReservationDetail } from "@/server/reservations/queries";
import { requireUser } from "@/server/session";

export async function cancelReservationAction(_prev: RentalActionState, formData: FormData): Promise<RentalActionState> {
  const reservationId = String(formData.get("reservationId") ?? "");
  const user = await requireUser(`/rentals/${reservationId}`);
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 200) || undefined;
  try {
    await cancelReservation({ reservationId, actor: { userId: user.id, role: "CUSTOMER" }, reason });
  } catch (err) {
    if (isReservationError(err)) return { error: err.message };
    console.error(JSON.stringify({ level: "error", msg: "cancel failed", reservationId, err: String(err) }));
    return { error: "We couldn't cancel this reservation right now. Please try again." };
  }
  revalidatePath("/rentals");
  redirect(`/rentals/${reservationId}?cancelled=1`);
}

export async function modifyDatesAction(_prev: RentalActionState, formData: FormData): Promise<RentalActionState> {
  const reservationId = String(formData.get("reservationId") ?? "");
  const user = await requireUser(`/rentals/${reservationId}`);
  const newStart = String(formData.get("newStart") ?? "");
  const newEnd = String(formData.get("newEnd") ?? "");
  if (!isLocalDateTime(newStart) || !isLocalDateTime(newEnd)) return { error: "Choose valid new dates." };
  // Only the owner's reservation is loaded, so the branch time zone can't be used to probe others.
  const d = await getReservationDetail(reservationId, { userId: user.id });
  if (!d) return { error: "Reservation not found." };
  try {
    await modifyReservation({
      reservationId,
      actor: { userId: user.id, role: "CUSTOMER" },
      pickupAt: localToUtc(newStart, d.pickupBranch.timeZone),
      returnAt: localToUtc(newEnd, d.pickupBranch.timeZone),
      paymentMethod: String(formData.get("paymentMethod") ?? "") || undefined,
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
    });
  } catch (err) {
    if (isReservationError(err)) return { error: err.message };
    console.error(JSON.stringify({ level: "error", msg: "modify failed", reservationId, err: String(err) }));
    return { error: "We couldn't change your dates right now. Please try again." };
  }
  revalidatePath("/rentals");
  redirect(`/rentals/${reservationId}?modified=1`);
}
