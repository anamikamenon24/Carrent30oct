/**
 * Server-side pricing. Pure functions: no database access, all money in integer fils (AED minor units).
 *
 * Rules (documented in docs/pricing-and-cancellation.md):
 * - Rental days: ceil((duration - 59 min grace) / 24 h), minimum 1. So 24h59m = 1 day, 25h00m = 2 days.
 * - Daily rate: vehicle.daily_rate_fils, else its category's daily_rate_fils. Rental day i starts at
 *   pickup + i x 24h; its local date (pick-up branch time zone) picks the SEASONAL rule (highest priority wins).
 * - DURATION_DISCOUNT: the matching rule with the largest min_days <= days takes |bps| off the rental (not extras).
 * - Extras: PER_DAY = price x qty x days; PER_RENTAL = price x qty. Quantity 1..max_quantity.
 * - One-way fee: only when return branch != pick-up branch; most specific ONE_WAY_FEE rule wins, none = 0.
 * - VAT 5% on (rental - discount + extras + one-way fee). Deposit is not taxed and not part of the total.
 * - Late return: 59 min grace; then each started hour costs 25% of the daily rate, capped at one daily rate
 *   per started 24h; plus VAT.
 * - Fuel: each missing eighth of a tank vs pick-up costs AED 50, plus VAT.
 * Rounding: half away from zero, to whole fils, per line.
 */

export const CURRENCY = "AED";
export const VAT_BPS = 500;
export const DAY_GRACE_MINUTES = 59;
export const LATE_GRACE_MINUTES = 59;
export const LATE_HOURLY_BPS = 2_500;
export const FUEL_FILS_PER_EIGHTH = 5_000;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export type ExtraPricing = "PER_DAY" | "PER_RENTAL";

/** Rounds half away from zero. */
function roundHalfAway(x: number) {
  return Math.sign(x) * Math.round(Math.abs(x));
}

/** `amount` x bps / 10000, rounded to whole fils. */
export function applyBps(amountFils: number, bps: number) {
  return roundHalfAway((amountFils * bps) / 10_000);
}

export function vatOn(amountFils: number, vatBps = VAT_BPS) {
  return applyBps(amountFils, vatBps);
}

export function rentalDays(pickupAt: Date, returnAt: Date) {
  const minutes = (returnAt.getTime() - pickupAt.getTime()) / MINUTE;
  if (!(minutes > 0)) throw new RangeError("Return must be after pick-up");
  return Math.max(1, Math.ceil((minutes - DAY_GRACE_MINUTES) / (24 * 60)));
}

/** "YYYY-MM-DD" of `date` in `timeZone`. */
export function localDate(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export interface PricingRuleInput {
  id: string;
  name: string;
  type: "SEASONAL" | "DURATION_DISCOUNT" | "ONE_WAY_FEE";
  categoryId: string | null;
  pickupBranchId: string | null;
  returnBranchId: string | null;
  validFrom: string | null;
  validTo: string | null;
  minDays: number | null;
  adjustmentBps: number | null;
  amountFils: number | null;
  priority: number;
  isActive: boolean;
}

export interface ExtraInput {
  id: string;
  code: string;
  name: string;
  pricing: ExtraPricing;
  priceFils: number;
  maxQuantity: number;
}

export interface QuoteInput {
  categoryId: string;
  baseDailyRateFils: number;
  depositFils: number;
  pickupBranchId: string;
  returnBranchId: string;
  /** Time zone of the pick-up branch (for seasonal dates). */
  timeZone: string;
  pickupAt: Date;
  returnAt: Date;
  rules: PricingRuleInput[];
  extras: { extra: ExtraInput; quantity: number }[];
  vatBps?: number;
}

export interface QuoteDay {
  date: string;
  rateFils: number;
  ruleId: string | null;
}

export interface QuoteExtraLine {
  extraId: string;
  code: string;
  name: string;
  pricing: ExtraPricing;
  quantity: number;
  unitPriceFils: number;
  totalFils: number;
}

export interface Quote {
  currency: typeof CURRENCY;
  days: number;
  /** Daily rate before seasonal adjustments. */
  baseDailyRateFils: number;
  /** Rental (after seasonal adjustments) / days, rounded. For display. */
  averageDailyRateFils: number;
  dailyRates: QuoteDay[];
  rentalFils: number;
  discountFils: number;
  discountRule: { id: string; name: string; bps: number } | null;
  extras: QuoteExtraLine[];
  extrasFils: number;
  oneWayFeeFils: number;
  oneWayRuleId: string | null;
  subtotalFils: number;
  vatBps: number;
  vatFils: number;
  /** Charged at payment time. */
  totalFils: number;
  /** Authorised (held) on the card at payment time and released after return. */
  depositFils: number;
}

const appliesToCategory = (r: PricingRuleInput, categoryId: string) => r.categoryId === null || r.categoryId === categoryId;

export function computeQuote(input: QuoteInput): Quote {
  const vatBps = input.vatBps ?? VAT_BPS;
  const days = rentalDays(input.pickupAt, input.returnAt);
  const rules = input.rules.filter((r) => r.isActive && appliesToCategory(r, input.categoryId));

  const seasonal = rules
    .filter((r) => r.type === "SEASONAL")
    .sort((a, b) => b.priority - a.priority || Number(b.categoryId !== null) - Number(a.categoryId !== null));
  const dailyRates: QuoteDay[] = [];
  for (let i = 0; i < days; i++) {
    const date = localDate(new Date(input.pickupAt.getTime() + i * DAY), input.timeZone);
    const rule = seasonal.find((r) => r.validFrom! <= date && date <= r.validTo!);
    const rate = rule ? input.baseDailyRateFils + applyBps(input.baseDailyRateFils, rule.adjustmentBps!) : input.baseDailyRateFils;
    dailyRates.push({ date, rateFils: Math.max(rate, 0), ruleId: rule?.id ?? null });
  }
  const rentalFils = dailyRates.reduce((s, d) => s + d.rateFils, 0);

  const discount = rules
    .filter((r) => r.type === "DURATION_DISCOUNT" && r.minDays! <= days)
    .sort((a, b) => b.minDays! - a.minDays! || b.priority - a.priority)[0];
  const discountFils = discount ? Math.min(rentalFils, applyBps(rentalFils, -discount.adjustmentBps!)) : 0;

  const extras: QuoteExtraLine[] = input.extras.map(({ extra, quantity }) => {
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > extra.maxQuantity) {
      throw new RangeError(`Quantity for ${extra.name} must be between 1 and ${extra.maxQuantity}`);
    }
    const totalFils = extra.priceFils * quantity * (extra.pricing === "PER_DAY" ? days : 1);
    return {
      extraId: extra.id,
      code: extra.code,
      name: extra.name,
      pricing: extra.pricing,
      quantity,
      unitPriceFils: extra.priceFils,
      totalFils,
    };
  });
  const extrasFils = extras.reduce((s, e) => s + e.totalFils, 0);

  let oneWayFeeFils = 0;
  let oneWayRuleId: string | null = null;
  if (input.pickupBranchId !== input.returnBranchId) {
    const specificity = (r: PricingRuleInput) =>
      (r.pickupBranchId ? 2 : 0) + (r.returnBranchId ? 2 : 0) + (r.categoryId ? 1 : 0);
    const rule = rules
      .filter(
        (r) =>
          r.type === "ONE_WAY_FEE" &&
          (r.pickupBranchId === null || r.pickupBranchId === input.pickupBranchId) &&
          (r.returnBranchId === null || r.returnBranchId === input.returnBranchId),
      )
      .sort((a, b) => specificity(b) - specificity(a) || b.priority - a.priority)[0];
    if (rule) {
      oneWayFeeFils = rule.amountFils!;
      oneWayRuleId = rule.id;
    }
  }

  const subtotalFils = rentalFils - discountFils + extrasFils + oneWayFeeFils;
  const vatFils = vatOn(subtotalFils, vatBps);
  return {
    currency: CURRENCY,
    days,
    baseDailyRateFils: input.baseDailyRateFils,
    averageDailyRateFils: Math.round(rentalFils / days),
    dailyRates,
    rentalFils,
    discountFils,
    discountRule: discount ? { id: discount.id, name: discount.name, bps: discount.adjustmentBps! } : null,
    extras,
    extrasFils,
    oneWayFeeFils,
    oneWayRuleId,
    subtotalFils,
    vatBps,
    vatFils,
    totalFils: subtotalFils + vatFils,
    depositFils: input.depositFils,
  };
}

export interface LateReturnCharge {
  lateMinutes: number;
  chargedHours: number;
  feeFils: number;
}

/** Late-return fee (before VAT). */
export function lateReturnCharge(dailyRateFils: number, scheduledReturnAt: Date, actualReturnAt: Date): LateReturnCharge {
  const lateMinutes = Math.max(0, Math.floor((actualReturnAt.getTime() - scheduledReturnAt.getTime()) / MINUTE));
  if (lateMinutes <= LATE_GRACE_MINUTES) return { lateMinutes, chargedHours: 0, feeFils: 0 };
  const hours = Math.ceil(lateMinutes / 60);
  const hourly = applyBps(dailyRateFils, LATE_HOURLY_BPS);
  const fullDays = Math.floor(hours / 24);
  const rest = hours % 24;
  return { lateMinutes, chargedHours: hours, feeFils: fullDays * dailyRateFils + Math.min(rest * hourly, dailyRateFils) };
}

/** Refuelling charge (before VAT) for returning with less fuel than at pick-up. */
export function fuelCharge(pickupFuelEighths: number, returnFuelEighths: number) {
  return Math.max(0, pickupFuelEighths - returnFuelEighths) * FUEL_FILS_PER_EIGHTH;
}

/** Formats fils as "AED 1,234.50". */
export function formatAed(fils: number) {
  return `AED ${(fils / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
