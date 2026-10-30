export interface ReleaseExpiredHoldsResult {
  released: number;
}

/**
 * Releases rental holds whose time limit has passed, freeing the car for other renters.
 *
 * TODO: implement once the bookings/holds tables exist in src/server/db/schema.ts
 * (e.g. update holds set status = 'expired' where status = 'active' and expires_at < now,
 * and release any linked deposit via getPayments().releaseDeposit).
 */
export async function releaseExpiredHolds(now: Date = new Date()): Promise<ReleaseExpiredHoldsResult> {
  void now;
  return { released: 0 };
}
