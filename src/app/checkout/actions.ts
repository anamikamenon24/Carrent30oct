"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { PayState } from "@/components/payment-form";
import { isReservationError } from "@/server/reservations/errors";
import { payReservation } from "@/server/reservations/payments";
import { requireUser } from "@/server/session";

export async function payAction(_prev: PayState, formData: FormData): Promise<PayState> {
  const reservationId = String(formData.get("reservationId") ?? "");
  const user = await requireUser(`/checkout/${reservationId}`);
  if (formData.get("terms") !== "on") {
    return { error: "Please accept the rental terms and cancellation policy." };
  }
  const paymentMethod = String(formData.get("paymentMethod") ?? "");
  const idempotencyKey = String(formData.get("idempotencyKey") ?? "");

  try {
    const result = await payReservation({ reservationId, userId: user.id, paymentMethod, idempotencyKey });
    switch (result.status) {
      case "CONFIRMED":
      case "PROCESSING":
        break;
      case "PAYMENT_FAILED":
        return { error: `Your card was not charged (${humanReason(result.reason)}). Try another card.`, nextKey: randomUUID() };
      case "DEPOSIT_FAILED":
        return {
          error: `The deposit hold was declined (${humanReason(result.reason)}). Your rental payment went through; try another card for the deposit.`,
          nextKey: randomUUID(),
        };
    }
  } catch (err) {
    if (isReservationError(err)) return { error: err.message, nextKey: randomUUID() };
    console.error(JSON.stringify({ level: "error", msg: "payment failed", reservationId, err: String(err) }));
    return { error: "We couldn't process the payment right now. Please try again in a moment.", nextKey: randomUUID() };
  }
  revalidatePath("/rentals");
  redirect(`/rentals/${reservationId}/voucher`);
}

function humanReason(reason: string): string {
  const r = reason.toLowerCase();
  if (r.includes("declined")) return "the card was declined";
  if (r.includes("cancel")) return "the payment was cancelled";
  if (r.includes("insufficient")) return "insufficient funds";
  return reason.replace(/_/g, " ");
}
