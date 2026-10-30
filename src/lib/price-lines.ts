import type { PriceLines } from "@/components/price-breakdown";

/** Maps a server quote (src/server/pricing Quote) to the price-breakdown view. */
export function quoteToLines(q: {
  days: number;
  averageDailyRateFils: number;
  rentalFils: number;
  discountFils: number;
  extras: { code: string; name: string; quantity: number; totalFils: number }[];
  extrasFils: number;
  oneWayFeeFils: number;
  vatBps: number;
  vatFils: number;
  totalFils: number;
  depositFils: number;
}): PriceLines {
  return {
    rentalDays: q.days,
    dailyRateFils: q.averageDailyRateFils,
    rentalFils: q.rentalFils,
    discountFils: q.discountFils,
    extras: q.extras.map((e) => ({ code: e.code, name: e.name, quantity: e.quantity, totalFils: e.totalFils })),
    extrasFils: q.extrasFils,
    oneWayFeeFils: q.oneWayFeeFils,
    vatBps: q.vatBps,
    vatFils: q.vatFils,
    totalFils: q.totalFils,
    depositFils: q.depositFils,
  };
}

/** Maps a stored reservation (amounts frozen at booking time) to the price-breakdown view. */
export function reservationToLines(
  r: {
    rentalDays: number;
    dailyRateFils: number;
    rentalFils: number;
    discountFils: number;
    extrasFils: number;
    oneWayFeeFils: number;
    vatBps: number;
    vatFils: number;
    totalFils: number;
    depositFils: number;
  },
  extras: { code: string; name: string; quantity: number; totalFils: number }[],
): PriceLines {
  return {
    rentalDays: r.rentalDays,
    dailyRateFils: r.dailyRateFils,
    rentalFils: r.rentalFils,
    discountFils: r.discountFils,
    extras: extras.map((e) => ({ code: e.code, name: e.name, quantity: e.quantity, totalFils: e.totalFils })),
    extrasFils: r.extrasFils,
    oneWayFeeFils: r.oneWayFeeFils,
    vatBps: r.vatBps,
    vatFils: r.vatFils,
    totalFils: r.totalFils,
    depositFils: r.depositFils,
  };
}
