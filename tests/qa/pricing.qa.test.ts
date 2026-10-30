import { describe, expect, it } from "vitest";
import {
  computeQuote,
  fuelCharge,
  lateReturnCharge,
  rentalDays,
  type ExtraInput,
  type PricingRuleInput,
  type QuoteInput,
} from "@/server/pricing";
import { cancellationTerms, canModify } from "@/server/reservations/policy";

// Brief: "Verify daily rates, extras, one-way fees, taxes, late-return charges, and deposit amounts".
// Expected values are worked out by hand from the documented rules, not by calling the code.

const H = 3_600_000;
const M = 60_000;
const T0 = new Date("2027-05-10T10:00:00+04:00");
const at = (ms: number) => new Date(T0.getTime() + ms);

const CAT = "cat-economy";
const DXB = "br-dxb";
const AUH = "br-auh";

const childSeat: ExtraInput = { id: "x1", code: "child_seat", name: "Child seat", pricing: "PER_DAY", priceFils: 25_00, maxQuantity: 3 };
const gps: ExtraInput = { id: "x2", code: "gps", name: "GPS", pricing: "PER_RENTAL", priceFils: 30_00, maxQuantity: 1 };

const rule = (r: Partial<PricingRuleInput> & Pick<PricingRuleInput, "type">): PricingRuleInput => ({
  id: `r-${Math.random()}`,
  name: r.type,
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
  ...r,
});

const quote = (over: Partial<QuoteInput> = {}) =>
  computeQuote({
    categoryId: CAT,
    baseDailyRateFils: 150_00,
    depositFils: 1_000_00,
    pickupBranchId: DXB,
    returnBranchId: DXB,
    timeZone: "Asia/Dubai",
    pickupAt: T0,
    returnAt: at(72 * H),
    rules: [],
    extras: [],
    ...over,
  });

describe("rental days (59-minute grace)", () => {
  const cases: [string, number, number][] = [
    ["1 hour", 1 * H, 1],
    ["exactly 24h", 24 * H, 1],
    ["24h59m", 24 * H + 59 * M, 1],
    ["25h00m", 25 * H, 2],
    ["48h59m", 48 * H + 59 * M, 2],
    ["49h", 49 * H, 3],
    ["72h", 72 * H, 3],
    ["30 days", 30 * 24 * H, 30],
  ];
  for (const [label, ms, days] of cases) {
    it(`${label} → ${days} day(s)`, () => expect(rentalDays(T0, at(ms))).toBe(days));
  }
  it("rejects zero or negative durations", () => {
    expect(() => rentalDays(T0, T0)).toThrow(RangeError);
    expect(() => rentalDays(T0, at(-H))).toThrow(RangeError);
  });
});

describe("quote", () => {
  it("3 days, same branch, no extras: AED 450 + 5% VAT, deposit separate", () => {
    expect(quote()).toMatchObject({
      days: 3,
      rentalFils: 450_00,
      discountFils: 0,
      extrasFils: 0,
      oneWayFeeFils: 0,
      subtotalFils: 450_00,
      vatBps: 500,
      vatFils: 22_50,
      totalFils: 472_50,
      depositFils: 1_000_00,
      currency: "AED",
    });
  });

  it("per-day and per-rental extras, one-way fee, VAT on all of them but not on the deposit", () => {
    const q = quote({
      returnBranchId: AUH,
      rules: [rule({ type: "ONE_WAY_FEE", amountFils: 100_00 })],
      extras: [{ extra: childSeat, quantity: 2 }, { extra: gps, quantity: 1 }],
    });
    // child seat 25 x 2 x 3 days = 150; GPS 30 once; one-way 100.
    expect(q.extras.map((e) => [e.code, e.totalFils])).toEqual([["child_seat", 150_00], ["gps", 30_00]]);
    expect(q).toMatchObject({
      extrasFils: 180_00,
      oneWayFeeFils: 100_00,
      subtotalFils: 450_00 + 180_00 + 100_00,
      vatFils: 36_50,
      totalFils: 766_50,
      depositFils: 1_000_00,
    });
  });

  it("no one-way fee when returning to the pick-up branch, even if a fee rule exists", () => {
    expect(quote({ rules: [rule({ type: "ONE_WAY_FEE", amountFils: 100_00 })] }).oneWayFeeFils).toBe(0);
  });

  it("one-way: no matching rule → 0; route-specific rule beats a generic one", () => {
    expect(quote({ returnBranchId: AUH }).oneWayFeeFils).toBe(0);
    const q = quote({
      returnBranchId: AUH,
      rules: [
        rule({ type: "ONE_WAY_FEE", amountFils: 100_00, priority: 10 }),
        rule({ type: "ONE_WAY_FEE", amountFils: 75_00, pickupBranchId: DXB, returnBranchId: AUH }),
        rule({ type: "ONE_WAY_FEE", amountFils: 999_00, pickupBranchId: AUH, returnBranchId: DXB }),
      ],
    });
    expect(q.oneWayFeeFils).toBe(75_00);
  });

  it("rounds VAT half away from zero to whole fils", () => {
    // 1 day at 123.45 → VAT 6.1725 → 6.17; at 123.50 → 6.175 → 6.18.
    expect(quote({ baseDailyRateFils: 123_45, returnAt: at(24 * H) }).vatFils).toBe(6_17);
    expect(quote({ baseDailyRateFils: 123_50, returnAt: at(24 * H) }).vatFils).toBe(6_18);
  });

  it("duration discount: the largest qualifying min_days wins, applies to rental only", () => {
    const rules = [
      rule({ type: "DURATION_DISCOUNT", minDays: 3, adjustmentBps: -500 }),
      rule({ type: "DURATION_DISCOUNT", minDays: 7, adjustmentBps: -1000 }),
    ];
    const five = quote({ rules, returnAt: at(5 * 24 * H), extras: [{ extra: gps, quantity: 1 }] });
    expect(five).toMatchObject({ rentalFils: 750_00, discountFils: 37_50, extrasFils: 30_00, subtotalFils: 742_50 });
    const seven = quote({ rules, returnAt: at(7 * 24 * H) });
    expect(seven).toMatchObject({ rentalFils: 1050_00, discountFils: 105_00, subtotalFils: 945_00, vatFils: 47_25 });
    expect(quote({ rules, returnAt: at(2 * 24 * H) }).discountFils).toBe(0);
  });

  it("seasonal rates use the pick-up branch's local date, not UTC", () => {
    // 2027-12-30 21:30Z is already 31 Dec in Dubai, so day 1 is in season.
    const pickupAt = new Date("2027-12-30T21:30:00Z");
    const q = quote({
      pickupAt,
      returnAt: new Date(pickupAt.getTime() + 2 * 24 * H),
      rules: [rule({ type: "SEASONAL", validFrom: "2027-12-31", validTo: "2027-12-31", adjustmentBps: 2000 })],
    });
    expect(q.dailyRates.map((d) => [d.date, d.rateFils])).toEqual([["2027-12-31", 180_00], ["2028-01-01", 150_00]]);
    expect(q.rentalFils).toBe(330_00);
  });

  it("ignores inactive rules and rules for other categories", () => {
    const q = quote({
      returnBranchId: AUH,
      rules: [
        rule({ type: "ONE_WAY_FEE", amountFils: 100_00, isActive: false }),
        rule({ type: "ONE_WAY_FEE", amountFils: 50_00, categoryId: "cat-luxury" }),
        rule({ type: "DURATION_DISCOUNT", minDays: 2, adjustmentBps: -5000, categoryId: "cat-luxury" }),
      ],
    });
    expect(q.oneWayFeeFils).toBe(0);
    expect(q.discountFils).toBe(0);
  });

  it("rejects extra quantities outside 1..max", () => {
    expect(() => quote({ extras: [{ extra: childSeat, quantity: 4 }] })).toThrow(RangeError);
    expect(() => quote({ extras: [{ extra: childSeat, quantity: 0 }] })).toThrow(RangeError);
    expect(() => quote({ extras: [{ extra: childSeat, quantity: 1.5 }] })).toThrow(RangeError);
  });

  it("every amount is an integer and the totals add up (500 random quotes)", () => {
    let seed = 42;
    const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31), seed % n);
    for (let i = 0; i < 500; i++) {
      const q = quote({
        baseDailyRateFils: 50_00 + rnd(200_000),
        returnAt: at((1 + rnd(30 * 24 * 60)) * M),
        returnBranchId: rnd(2) ? AUH : DXB,
        rules: [
          rule({ type: "ONE_WAY_FEE", amountFils: rnd(50_000) }),
          rule({ type: "DURATION_DISCOUNT", minDays: 2 + rnd(10), adjustmentBps: -rnd(9000) }),
          rule({ type: "SEASONAL", validFrom: "2027-05-12", validTo: "2027-05-20", adjustmentBps: rnd(30000) - 9000 }),
        ],
        extras: [{ extra: childSeat, quantity: 1 + rnd(3) }, { extra: gps, quantity: 1 }],
      });
      for (const [k, v] of Object.entries(q)) if (typeof v === "number") expect(Number.isInteger(v), k).toBe(true);
      expect(q.rentalFils).toBe(q.dailyRates.reduce((s, d) => s + d.rateFils, 0));
      expect(q.subtotalFils).toBe(q.rentalFils - q.discountFils + q.extrasFils + q.oneWayFeeFils);
      expect(q.vatFils).toBe(Math.round(q.subtotalFils * 0.05));
      expect(q.totalFils).toBe(q.subtotalFils + q.vatFils);
      expect(q.discountFils).toBeGreaterThanOrEqual(0);
      expect(q.discountFils).toBeLessThanOrEqual(q.rentalFils);
    }
  });
});

describe("late return", () => {
  const daily = 150_00; // hourly late rate = 25% = 37.50
  const cases: [string, number, number][] = [
    ["on time", 0, 0],
    ["early", -2 * H, 0],
    ["59 min late (grace)", 59 * M, 0],
    ["60 min late", 60 * M, 37_50],
    ["61 min late → 2 started hours", 61 * M, 75_00],
    ["3h late", 3 * H, 112_50],
    ["4h late → capped at one day", 4 * H, 150_00],
    ["10h late → still one day", 10 * H, 150_00],
    ["25h late → one day + 1 hour", 25 * H, 187_50],
    ["48h late → two days", 48 * H, 300_00],
  ];
  for (const [label, ms, fee] of cases) {
    it(`${label} → ${fee} fils`, () => {
      expect(lateReturnCharge(daily, T0, at(ms)).feeFils).toBe(fee);
    });
  }
});

describe("fuel charge", () => {
  it("charges AED 50 per missing eighth and nothing for a fuller tank", () => {
    expect(fuelCharge(8, 6)).toBe(100_00);
    expect(fuelCharge(6, 8)).toBe(0);
    expect(fuelCharge(8, 8)).toBe(0);
  });
});

describe("cancellation policy", () => {
  const r = (status: string, hoursBefore: number) => ({
    status,
    pickupAt: at(0),
    totalFils: 766_50,
    dailyRateFils: 150_00,
    vatBps: 500,
    now: at(-hoursBefore * H),
  });
  const terms = (status: string, hoursBefore: number) => {
    const x = r(status, hoursBefore);
    return cancellationTerms(x, x.now);
  };

  it("unpaid holds cancel free", () => expect(terms("PENDING", 1)).toMatchObject({ allowed: true, feeFils: 0 }));
  it("≥ 48h before: free", () => {
    expect(terms("CONFIRMED", 72)).toMatchObject({ allowed: true, feeFils: 0, tier: "FREE" });
    expect(terms("CONFIRMED", 48)).toMatchObject({ allowed: true, feeFils: 0, tier: "FREE" });
  });
  it("24–48h before: one day's rental incl. VAT is kept", () => {
    expect(terms("CONFIRMED", 30)).toMatchObject({ allowed: true, feeFils: 157_50, tier: "ONE_DAY" });
  });
  it("< 24h before: half the total is kept", () => {
    expect(terms("CONFIRMED", 10)).toMatchObject({ allowed: true, feeFils: 383_25, tier: "HALF" });
  });
  it("after pick-up time or once picked up: not allowed", () => {
    expect(terms("CONFIRMED", -1).allowed).toBe(false);
    expect(terms("PICKED_UP", 10).allowed).toBe(false);
    expect(terms("RETURNED", 100).allowed).toBe(false);
    expect(terms("CANCELLED", 100).allowed).toBe(false);
  });
  it("date changes allowed until 24h before pick-up", () => {
    expect(canModify({ status: "CONFIRMED", pickupAt: at(0) }, at(-25 * H)).allowed).toBe(true);
    expect(canModify({ status: "CONFIRMED", pickupAt: at(0) }, at(-23 * H)).allowed).toBe(false);
    expect(canModify({ status: "PICKED_UP", pickupAt: at(0) }, at(-48 * H)).allowed).toBe(false);
  });
});
