import { describe, expect, it } from "vitest";
import { cancellationTerms, canModify } from "@/server/reservations/policy";
import { applyBps, computeQuote, fuelCharge, lateReturnCharge, rentalDays, type PricingRuleInput, type QuoteInput } from "./index";

const H = 3_600_000;
const t0 = new Date("2026-11-10T06:00:00Z"); // 10:00 in Dubai
const at = (hours: number) => new Date(t0.getTime() + hours * H);

const rule = (o: Partial<PricingRuleInput> & Pick<PricingRuleInput, "type">): PricingRuleInput => ({
  id: Math.random().toString(36).slice(2),
  name: o.type,
  categoryId: null,
  pickupBranchId: null,
  returnBranchId: null,
  validFrom: null,
  validTo: null,
  minDays: null,
  adjustmentBps: null,
  amountFils: null,
  priority: 0,
  isActive: true,
  ...o,
});

const base = (o: Partial<QuoteInput> = {}): QuoteInput => ({
  categoryId: "cat",
  baseDailyRateFils: 20_000,
  depositFils: 100_000,
  pickupBranchId: "A",
  returnBranchId: "A",
  timeZone: "Asia/Dubai",
  pickupAt: t0,
  returnAt: at(72),
  rules: [],
  extras: [],
  ...o,
});

describe("rentalDays", () => {
  it("counts 24h blocks with a 59-minute grace, minimum one day", () => {
    expect(rentalDays(t0, at(1))).toBe(1);
    expect(rentalDays(t0, at(24))).toBe(1);
    expect(rentalDays(t0, new Date(at(24).getTime() + 59 * 60_000))).toBe(1);
    expect(rentalDays(t0, at(25))).toBe(2);
    expect(rentalDays(t0, at(72))).toBe(3);
    expect(() => rentalDays(t0, t0)).toThrow();
  });
});

describe("computeQuote", () => {
  it("prices rental, extras, one-way fee and 5% VAT; deposit is separate", () => {
    const q = computeQuote(
      base({
        returnBranchId: "B",
        rules: [
          rule({ type: "ONE_WAY_FEE", amountFils: 25_000 }),
          rule({ type: "ONE_WAY_FEE", pickupBranchId: "A", returnBranchId: "B", amountFils: 7_500 }),
        ],
        extras: [
          { extra: { id: "e1", code: "SEAT", name: "Seat", pricing: "PER_DAY", priceFils: 2_500, maxQuantity: 3 }, quantity: 2 },
          { extra: { id: "e2", code: "FUEL", name: "Fuel", pricing: "PER_RENTAL", priceFils: 18_000, maxQuantity: 1 }, quantity: 1 },
        ],
      }),
    );
    expect(q.days).toBe(3);
    expect(q.rentalFils).toBe(60_000);
    expect(q.extrasFils).toBe(2_500 * 2 * 3 + 18_000);
    expect(q.oneWayFeeFils).toBe(7_500); // most specific rule wins
    expect(q.subtotalFils).toBe(60_000 + 33_000 + 7_500);
    expect(q.vatFils).toBe(5_025);
    expect(q.totalFils).toBe(105_525);
    expect(q.depositFils).toBe(100_000);
  });

  it("charges no one-way fee for a same-branch return", () => {
    expect(computeQuote(base({ rules: [rule({ type: "ONE_WAY_FEE", amountFils: 25_000 })] })).oneWayFeeFils).toBe(0);
  });

  it("applies seasonal rates per local day and the best duration discount", () => {
    const q = computeQuote(
      base({
        pickupAt: new Date("2026-12-12T06:00:00Z"),
        returnAt: new Date("2026-12-19T06:00:00Z"),
        rules: [
          rule({ type: "SEASONAL", validFrom: "2026-12-15", validTo: "2027-01-05", adjustmentBps: 2_000 }),
          rule({ type: "DURATION_DISCOUNT", minDays: 7, adjustmentBps: -1_000 }),
          rule({ type: "DURATION_DISCOUNT", minDays: 28, adjustmentBps: -2_500 }),
          rule({ type: "SEASONAL", categoryId: "other", validFrom: "2026-12-01", validTo: "2026-12-31", adjustmentBps: 5_000 }),
        ],
      }),
    );
    expect(q.days).toBe(7);
    expect(q.dailyRates.map((d) => d.rateFils)).toEqual([20_000, 20_000, 20_000, 24_000, 24_000, 24_000, 24_000]);
    expect(q.rentalFils).toBe(156_000);
    expect(q.discountFils).toBe(15_600);
    expect(q.subtotalFils).toBe(140_400);
    expect(q.totalFils).toBe(140_400 + 7_020);
  });

  it("uses the branch's local date, not the UTC date", () => {
    // 22:00 UTC on 14 Dec is 02:00 on 15 Dec in Dubai.
    const q = computeQuote(
      base({
        pickupAt: new Date("2026-12-14T22:00:00Z"),
        returnAt: new Date("2026-12-15T22:00:00Z"),
        rules: [rule({ type: "SEASONAL", validFrom: "2026-12-15", validTo: "2026-12-15", adjustmentBps: 1_000 })],
      }),
    );
    expect(q.rentalFils).toBe(22_000);
  });

  it("rejects extra quantities above the maximum", () => {
    expect(() =>
      computeQuote(base({ extras: [{ extra: { id: "e", code: "GPS", name: "GPS", pricing: "PER_DAY", priceFils: 1, maxQuantity: 1 }, quantity: 2 }] })),
    ).toThrow(/between 1 and 1/);
  });
});

describe("return charges", () => {
  it("has a 59-minute grace, then 25% of the daily rate per started hour, capped per 24h", () => {
    expect(lateReturnCharge(20_000, t0, at(59 / 60)).feeFils).toBe(0);
    expect(lateReturnCharge(20_000, t0, at(1)).feeFils).toBe(5_000);
    expect(lateReturnCharge(20_000, t0, at(2.5)).feeFils).toBe(15_000);
    expect(lateReturnCharge(20_000, t0, at(10)).feeFils).toBe(20_000);
    expect(lateReturnCharge(20_000, t0, at(26)).feeFils).toBe(20_000 + 10_000);
    expect(lateReturnCharge(20_000, t0, at(-3)).feeFils).toBe(0);
  });

  it("charges AED 50 per missing eighth of fuel", () => {
    expect(fuelCharge(8, 6)).toBe(10_000);
    expect(fuelCharge(4, 8)).toBe(0);
  });

  it("rounds half away from zero", () => {
    expect(applyBps(1_010, 500)).toBe(51);
    expect(applyBps(-1_010, 500)).toBe(-51);
  });
});

describe("cancellation policy", () => {
  const r = { status: "CONFIRMED", pickupAt: at(100), totalFils: 105_000, dailyRateFils: 20_000, vatBps: 500 };
  it("is free 48h+ before pick-up, one day 24-48h, half below 24h, closed after pick-up", () => {
    expect(cancellationTerms(r, at(100 - 48))).toMatchObject({ allowed: true, feeFils: 0, tier: "FREE" });
    expect(cancellationTerms(r, at(100 - 30))).toMatchObject({ allowed: true, feeFils: 21_000, tier: "ONE_DAY" });
    expect(cancellationTerms(r, at(100 - 5))).toMatchObject({ allowed: true, feeFils: 52_500, tier: "HALF" });
    expect(cancellationTerms(r, at(100))).toMatchObject({ allowed: false });
    expect(cancellationTerms({ ...r, status: "PENDING" }, at(99))).toMatchObject({ allowed: true, feeFils: 0 });
    expect(cancellationTerms({ ...r, status: "PICKED_UP" }, at(0))).toMatchObject({ allowed: false });
  });

  it("allows date changes until 24h before pick-up", () => {
    expect(canModify(r, at(100 - 25)).allowed).toBe(true);
    expect(canModify(r, at(100 - 23)).allowed).toBe(false);
  });
});
