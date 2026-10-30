import { applyBps, vatOn } from "@/server/pricing";

/**
 * Booking, modification and cancellation policy (also in docs/pricing-and-cancellation.md).
 */
export const POLICY = {
  /** Earliest pick-up: this long after "now". */
  minLeadMinutes: 60,
  /** Latest pick-up: this many days ahead. */
  maxAdvanceDays: 365,
  /** Longest single rental. */
  maxRentalDays: 90,
  /** Shortest single rental. */
  minRentalMinutes: 60,
  /** Free cancellation up to this many hours before pick-up. */
  freeCancellationHours: 48,
  /** Between this and freeCancellationHours: one day's rental (incl. VAT) is kept. Below it: 50% of the total. */
  lateCancellationHours: 24,
  lateCancellationBps: 5_000,
  /** Confirmed reservations can change dates until this many hours before the current pick-up. */
  modificationCutoffHours: 24,
  /** Staff may check a car out this long before the booked pick-up time. */
  earlyCheckoutMinutes: 120,
} as const;

export const CANCELLATION_POLICY_TEXT = [
  "Unpaid reservations (holds) can be cancelled at any time, free of charge.",
  `Free cancellation up to ${POLICY.freeCancellationHours} hours before pick-up: full refund.`,
  `${POLICY.lateCancellationHours}-${POLICY.freeCancellationHours} hours before pick-up: one day's rental (incl. VAT) is kept, the rest is refunded.`,
  `Less than ${POLICY.lateCancellationHours} hours before pick-up: 50% of the total is kept.`,
  "After the pick-up time (no-show) or once the car is picked up, the reservation can no longer be cancelled online.",
  "The security-deposit hold is always released in full when a reservation is cancelled.",
  `Dates can be changed up to ${POLICY.modificationCutoffHours} hours before pick-up, subject to availability; the price difference is charged or refunded.`,
];

const HOUR = 3_600_000;

export interface CancellationTerms {
  allowed: boolean;
  reason?: string;
  feeFils: number;
  tier: "UNPAID" | "FREE" | "ONE_DAY" | "HALF" | "NOT_ALLOWED";
}

export function cancellationTerms(
  r: { status: string; pickupAt: Date; totalFils: number; dailyRateFils: number; vatBps: number },
  now: Date,
): CancellationTerms {
  if (r.status === "PENDING") return { allowed: true, feeFils: 0, tier: "UNPAID" };
  if (r.status !== "CONFIRMED") {
    return { allowed: false, reason: `A ${r.status.toLowerCase()} reservation cannot be cancelled`, feeFils: 0, tier: "NOT_ALLOWED" };
  }
  const hoursBefore = (r.pickupAt.getTime() - now.getTime()) / HOUR;
  if (hoursBefore <= 0) {
    return { allowed: false, reason: "The pick-up time has passed", feeFils: 0, tier: "NOT_ALLOWED" };
  }
  if (hoursBefore >= POLICY.freeCancellationHours) return { allowed: true, feeFils: 0, tier: "FREE" };
  if (hoursBefore >= POLICY.lateCancellationHours) {
    const oneDay = r.dailyRateFils + vatOn(r.dailyRateFils, r.vatBps);
    return { allowed: true, feeFils: Math.min(oneDay, r.totalFils), tier: "ONE_DAY" };
  }
  return { allowed: true, feeFils: applyBps(r.totalFils, POLICY.lateCancellationBps), tier: "HALF" };
}

export function canModify(r: { status: string; pickupAt: Date }, now: Date): { allowed: boolean; reason?: string } {
  if (r.status === "PENDING") return r.pickupAt > now ? { allowed: true } : { allowed: false, reason: "The pick-up time has passed" };
  if (r.status !== "CONFIRMED") return { allowed: false, reason: `A ${r.status.toLowerCase()} reservation cannot be changed` };
  if (r.pickupAt.getTime() - now.getTime() < POLICY.modificationCutoffHours * HOUR) {
    return { allowed: false, reason: `Dates can only be changed up to ${POLICY.modificationCutoffHours} hours before pick-up` };
  }
  return { allowed: true };
}
