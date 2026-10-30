import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "@/server/db";
import { deposits, payments, reservations, vehicleOccupancy, vehicles, webhookEvents } from "@/server/db/schema";
import {
  createBookingScenario,
  createDriverProfile,
  createExtra,
  createMaintenanceBlock,
  createUser,
  createVehicle,
} from "@/server/db/test-fixtures";
import { releaseExpiredHolds } from "@/server/jobs/release-expired-holds";
import { getPayments } from "@/server/services";
import { FAKE_PAYMENT_METHODS, type FakePaymentProvider } from "@/server/services/payments/fake";
import {
  cancelReservation,
  checkIn,
  checkOut,
  createDamageReport,
  createReservationHold,
  getReservationDetail,
  modifyReservation,
  payReservation,
  processPaymentEvent,
  ReservationError,
  searchVehicles,
} from "./index";

const H = 3_600_000;
const DAY = 24 * H;
const fake = () => getPayments() as FakePaymentProvider;

/** A round hour some days ahead, so pick-up is always well in the future. */
function future(days: number, hourUtc = 6) {
  const d = new Date(Date.now() + days * DAY);
  d.setUTCHours(hourUtc, 0, 0, 0);
  return d;
}

type Scenario = Awaited<ReturnType<typeof createBookingScenario>>;
let s: Scenario;

beforeEach(async () => {
  s = await createBookingScenario();
});

afterAll(async () => {
  await closeDb();
});

function hold(sc: Scenario, pickupAt: Date, returnAt: Date, o: Partial<Parameters<typeof createReservationHold>[0]> = {}) {
  return createReservationHold({
    userId: sc.user.id,
    vehicleId: sc.vehicle.id,
    pickupBranchId: sc.pickupBranch.id,
    returnBranchId: sc.pickupBranch.id,
    pickupAt,
    returnAt,
    idempotencyKey: randomUUID(),
    ...o,
  });
}

async function confirmed(sc: Scenario, pickupAt: Date, returnAt: Date) {
  const { reservation } = await hold(sc, pickupAt, returnAt);
  const res = await payReservation({
    reservationId: reservation.id,
    userId: sc.user.id,
    paymentMethod: FAKE_PAYMENT_METHODS.success,
    idempotencyKey: randomUUID(),
  });
  expect(res.status).toBe("CONFIRMED");
  return reservation;
}

const expectCode = async (p: Promise<unknown>, code: string) => {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ReservationError);
  expect((err as ReservationError).code).toBe(code);
};

describe("database guards", () => {
  it("rejects overlapping active reservations and maintenance blocks at the database level", async () => {
    const p = future(10);
    await hold(s, p, new Date(p.getTime() + 2 * DAY));
    // Back-to-back maintenance is fine ('[)' ranges) ...
    await createMaintenanceBlock(s.vehicle.id, new Date(p.getTime() + 2 * DAY), new Date(p.getTime() + 3 * DAY));
    // ... an overlapping one is not.
    await expect(createMaintenanceBlock(s.vehicle.id, new Date(p.getTime() + DAY), new Date(p.getTime() + 4 * DAY))).rejects.toMatchObject({
      cause: { code: "23P01" },
    });
    const occ = await db.select().from(vehicleOccupancy).where(eq(vehicleOccupancy.vehicleId, s.vehicle.id));
    expect(occ.map((o) => o.kind).sort()).toEqual(["MAINTENANCE", "RESERVATION"]);
  });

  it("removes occupancy when a reservation stops being active", async () => {
    const p = future(10);
    const { reservation } = await hold(s, p, new Date(p.getTime() + DAY));
    await db.update(reservations).set({ status: "EXPIRED", expiredAt: new Date() }).where(eq(reservations.id, reservation.id));
    expect(await db.$count(vehicleOccupancy, eq(vehicleOccupancy.reservationId, reservation.id))).toBe(0);
  });
});

describe("createReservationHold", () => {
  it("creates a PENDING hold with a server-side price", async () => {
    const extra = await createExtra({ priceFils: 2_500, pricing: "PER_DAY" });
    const p = future(10);
    const { reservation, quote, replayed } = await hold(s, p, new Date(p.getTime() + 3 * DAY), {
      extras: [{ extraId: extra.id, quantity: 2 }],
    });
    expect(replayed).toBe(false);
    expect(reservation.status).toBe("PENDING");
    expect(reservation.holdExpiresAt!.getTime()).toBeGreaterThan(Date.now() + 14 * 60_000);
    expect(quote.rentalFils).toBe(60_000);
    expect(quote.extrasFils).toBe(15_000);
    expect(reservation.totalFils).toBe(Math.round(75_000 * 1.05));
    expect(reservation.reference).toMatch(/^DE-[A-Z2-9]{8}$/);
  });

  it("allows back-to-back rentals and rejects overlaps", async () => {
    const p = future(10);
    const end = new Date(p.getTime() + 2 * DAY);
    await hold(s, p, end);
    const other = await createUser();
    await expect(hold({ ...s, user: other }, end, new Date(end.getTime() + DAY))).resolves.toBeTruthy();
    await expectCode(hold({ ...s, user: other }, new Date(end.getTime() - 60_000 - H), new Date(end.getTime() + 5 * DAY)), "VEHICLE_UNAVAILABLE");
  });

  it("lets exactly one of many concurrent overlapping requests win", async () => {
    const p = future(12);
    const users = await Promise.all(Array.from({ length: 10 }, () => createUser()));
    const results = await Promise.allSettled(
      users.map((u, i) => hold({ ...s, user: u }, new Date(p.getTime() + i * H), new Date(p.getTime() + i * H + 2 * DAY))),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const r of results.filter((r) => r.status === "rejected")) {
      expect((r as PromiseRejectedResult).reason).toMatchObject({ code: "VEHICLE_UNAVAILABLE" });
    }
  });

  it("returns the same reservation for concurrent retries with one idempotency key", async () => {
    const p = future(14);
    const key = randomUUID();
    const results = await Promise.all(Array.from({ length: 5 }, () => hold(s, p, new Date(p.getTime() + DAY), { idempotencyKey: key })));
    expect(new Set(results.map((r) => r.reservation.id)).size).toBe(1);
    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
    await expectCode(hold(s, p, new Date(p.getTime() + 2 * DAY), { idempotencyKey: key }), "IDEMPOTENCY_CONFLICT");
  });

  it("ignores lapsed holds and refuses maintenance periods and retired vehicles", async () => {
    const p = future(16);
    const lapsed = await hold(s, p, new Date(p.getTime() + DAY), { now: new Date(Date.now() - 20 * 60_000) });
    expect(lapsed.reservation.holdExpiresAt!.getTime()).toBeLessThan(Date.now());
    const other = await createUser();
    const { reservation } = await hold({ ...s, user: other }, p, new Date(p.getTime() + DAY));
    expect(reservation.status).toBe("PENDING");
    const [old] = await db.select().from(reservations).where(eq(reservations.id, lapsed.reservation.id));
    expect(old.status).toBe("EXPIRED");

    await createMaintenanceBlock(s.vehicle.id, future(20), future(22));
    await expectCode(hold(s, future(21), future(23)), "VEHICLE_UNAVAILABLE");
    await db.update(vehicles).set({ status: "RETIRED" }).where(eq(vehicles.id, s.vehicle.id));
    await expectCode(hold(s, future(30), future(31)), "VEHICLE_NOT_RENTABLE");
  });

  it("validates ids and the booking window", async () => {
    await expectCode(hold(s, future(10), future(11), { vehicleId: "not-a-uuid" }), "NOT_FOUND");
    await expectCode(hold(s, new Date(Date.now() + 10 * 60_000), future(2)), "VALIDATION");
    await expectCode(hold(s, future(11), future(10)), "VALIDATION");
  });

  it("keeps a one-way car from being booked out of the wrong branch", async () => {
    const p = future(10);
    await hold(s, p, new Date(p.getTime() + DAY), { returnBranchId: s.returnBranch.id });
    const other = await createUser();
    await expectCode(hold({ ...s, user: other }, future(13), future(14)), "VEHICLE_UNAVAILABLE");
    await expect(
      hold({ ...s, user: other }, future(13), future(14), { pickupBranchId: s.returnBranch.id, returnBranchId: s.returnBranch.id }),
    ).resolves.toBeTruthy();
  });
});

describe("searchVehicles", () => {
  it("lists only vehicles free for the whole period at the pick-up branch", async () => {
    const free = await createVehicle({ categoryId: s.category.id, branchId: s.pickupBranch.id });
    const p = future(10);
    await hold(s, p, new Date(p.getTime() + 2 * DAY));
    const found = await searchVehicles({
      pickupBranchId: s.pickupBranch.id,
      returnBranchId: s.pickupBranch.id,
      start: new Date(p.getTime() + DAY),
      end: new Date(p.getTime() + 3 * DAY),
    });
    const ids = found.map((v) => v.id);
    expect(ids).toContain(free.id);
    expect(ids).not.toContain(s.vehicle.id);
    expect(found.find((v) => v.id === free.id)!.quote.days).toBe(2);
  });
});

describe("payReservation", () => {
  it("charges, holds the deposit and confirms; retrying the same key does not charge again", async () => {
    const p = future(10);
    const { reservation } = await hold(s, p, new Date(p.getTime() + 2 * DAY));
    const key = randomUUID();
    const before = fake().sentEvents.length;
    const pay = () => payReservation({ reservationId: reservation.id, userId: s.user.id, paymentMethod: FAKE_PAYMENT_METHODS.success, idempotencyKey: key });
    expect((await pay()).status).toBe("CONFIRMED");
    expect((await pay()).status).toBe("CONFIRMED");
    expect(fake().sentEvents.length - before).toBe(2); // one charge + one deposit hold

    const detail = (await getReservationDetail(reservation.id, { userId: s.user.id }))!;
    expect(detail.reservation.status).toBe("CONFIRMED");
    expect(detail.reservation.holdExpiresAt).toBeNull();
    expect(detail.payments).toMatchObject([{ status: "SUCCEEDED", amountFils: reservation.totalFils }]);
    expect(detail.deposits).toMatchObject([{ status: "HELD", amountFils: 100_000 }]);
    const [v] = await db.select().from(vehicles).where(eq(vehicles.id, s.vehicle.id));
    expect(v.status).toBe("RESERVED");
    expect(await getReservationDetail(reservation.id, { userId: (await createUser()).id })).toBeNull();
  });

  it("reports a declined card and keeps the hold; a later attempt can succeed", async () => {
    const { reservation } = await hold(s, future(10), future(12));
    const failed = await payReservation({ reservationId: reservation.id, userId: s.user.id, paymentMethod: FAKE_PAYMENT_METHODS.fail, idempotencyKey: randomUUID() });
    expect(failed).toMatchObject({ status: "PAYMENT_FAILED", reason: "card_declined" });
    const ok = await payReservation({ reservationId: reservation.id, userId: s.user.id, paymentMethod: FAKE_PAYMENT_METHODS.success, idempotencyKey: randomUUID() });
    expect(ok.status).toBe("CONFIRMED");
  });

  it("does not confirm without a deposit hold, and reuses the charge when retried", async () => {
    // The fake provider declines deposit holds for any method other than success; charge succeeds first.
    const { reservation } = await hold(s, future(10), future(12));
    const provider = fake();
    const original = provider.holdDeposit.bind(provider);
    provider.holdDeposit = async () => {
      throw new Error("Deposit hold declined: insufficient_funds");
    };
    try {
      const r1 = await payReservation({ reservationId: reservation.id, userId: s.user.id, paymentMethod: FAKE_PAYMENT_METHODS.success, idempotencyKey: randomUUID() });
      expect(r1.status).toBe("DEPOSIT_FAILED");
    } finally {
      provider.holdDeposit = original;
    }
    const r2 = await payReservation({ reservationId: reservation.id, userId: s.user.id, paymentMethod: FAKE_PAYMENT_METHODS.success, idempotencyKey: randomUUID() });
    expect(r2.status).toBe("CONFIRMED");
    const rows = await db.select().from(payments).where(eq(payments.reservationId, reservation.id));
    expect(rows.filter((p) => p.status === "SUCCEEDED")).toHaveLength(1);
  });

  it("requires an eligible driver and an unexpired hold", async () => {
    const user = await createUser();
    const { reservation } = await hold({ ...s, user }, future(10), future(11));
    const pay = (now?: Date) =>
      payReservation({ reservationId: reservation.id, userId: user.id, paymentMethod: FAKE_PAYMENT_METHODS.success, idempotencyKey: randomUUID(), now });
    await expectCode(pay(), "DRIVER_PROFILE_REQUIRED");
    await createDriverProfile(user.id, { dateOfBirth: new Date(Date.now() - 19 * 365 * DAY).toISOString().slice(0, 10) });
    await expectCode(pay(), "DRIVER_NOT_ELIGIBLE");
    await expectCode(pay(new Date(Date.now() + 16 * 60_000)), "HOLD_EXPIRED");
  });
});

describe("webhooks", () => {
  it("processes each event id once, even when delivered concurrently", async () => {
    const before = fake().sentEvents.length;
    await confirmed(s, future(10), future(12));
    const events = fake().sentEvents.slice(before);
    expect(events.map((e) => e.type)).toEqual(["charge.succeeded", "deposit.held"]);
    const first = await Promise.all(events.flatMap((e) => [processPaymentEvent("fake", e), processPaymentEvent("fake", e), processPaymentEvent("fake", e)]));
    expect(first.filter((r) => !r.duplicate)).toHaveLength(2);
    expect((await processPaymentEvent("fake", events[0])).duplicate).toBe(true);
    expect(await db.$count(webhookEvents, eq(webhookEvents.eventId, events[0].id))).toBe(1);
  });

  it("never moves a payment status backwards", async () => {
    const before = fake().sentEvents.length;
    const r = await confirmed(s, future(10), future(12));
    const charge = fake().sentEvents.slice(before).find((e) => e.type === "charge.succeeded")!;
    await cancelReservation({ reservationId: r.id, actor: { userId: s.user.id, role: "CUSTOMER" } });
    // A stale "succeeded" event arriving after the refund must not undo it.
    await processPaymentEvent("fake", { ...charge, id: `${charge.id}-late` });
    const [p] = await db.select().from(payments).where(eq(payments.reservationId, r.id));
    expect(p.status).toBe("REFUNDED");
  });
});

describe("cancelReservation", () => {
  const actor = () => ({ userId: s.user.id, role: "CUSTOMER" as const });

  it("refunds in full 48h+ before pick-up and releases the deposit", async () => {
    const r = await confirmed(s, future(10), future(12));
    const res = await cancelReservation({ reservationId: r.id, actor: actor() });
    expect(res).toMatchObject({ feeFils: 0, refundedFils: r.totalFils, depositsReleased: 1 });
    expect(res.reservation.status).toBe("REFUNDED");
    const [d] = await db.select().from(deposits).where(eq(deposits.reservationId, r.id));
    expect(d.status).toBe("RELEASED");
    expect(await db.$count(vehicleOccupancy, eq(vehicleOccupancy.reservationId, r.id))).toBe(0);
    // Repeating is harmless.
    expect((await cancelReservation({ reservationId: r.id, actor: actor() })).refundedFils).toBe(r.totalFils);
  });

  it("keeps one day 24-48h before pick-up and half below 24h", async () => {
    const p = future(10);
    const r1 = await confirmed(s, p, new Date(p.getTime() + 3 * DAY));
    const res1 = await cancelReservation({ reservationId: r1.id, actor: actor(), now: new Date(p.getTime() - 30 * H) });
    expect(res1.feeFils).toBe(21_000);
    expect(res1.refundedFils).toBe(r1.totalFils - 21_000);

    const p2 = future(20);
    const r2 = await confirmed(s, p2, new Date(p2.getTime() + 2 * DAY));
    const res2 = await cancelReservation({ reservationId: r2.id, actor: actor(), now: new Date(p2.getTime() - 5 * H) });
    expect(res2.feeFils).toBe(Math.round(r2.totalFils / 2));
    await expectCode(cancelReservation({ reservationId: r2.id, actor: { userId: (await createUser()).id, role: "CUSTOMER" } }), "NOT_FOUND");
  });

  it("cancels an unpaid hold for free and frees the vehicle", async () => {
    const { reservation } = await hold(s, future(10), future(11));
    const res = await cancelReservation({ reservationId: reservation.id, actor: actor() });
    expect(res.reservation.status).toBe("CANCELLED");
    expect(res.feeFils).toBe(0);
  });
});

describe("modifyReservation", () => {
  const actor = () => ({ userId: s.user.id, role: "CUSTOMER" as const });

  it("charges the difference for longer dates and refunds for shorter ones", async () => {
    const p = future(10);
    const r = await confirmed(s, p, new Date(p.getTime() + 2 * DAY));
    const longer = { reservationId: r.id, actor: actor(), pickupAt: p, returnAt: new Date(p.getTime() + 4 * DAY) };
    await expectCode(modifyReservation({ ...longer, idempotencyKey: randomUUID() }), "PAYMENT_REQUIRED");
    const up = await modifyReservation({ ...longer, idempotencyKey: randomUUID(), paymentMethod: FAKE_PAYMENT_METHODS.success });
    expect(up.differenceFils).toBe(42_000);
    expect(up.reservation.totalFils).toBe(84_000);

    const down = await modifyReservation({ ...longer, returnAt: new Date(p.getTime() + DAY), idempotencyKey: randomUUID() });
    expect(down.differenceFils).toBe(-63_000);
    const { rows } = await db.execute<{ net: number }>(
      sql`select sum(amount_fils - refunded_fils)::int as net from payments where reservation_id = ${r.id}::uuid and status in ('SUCCEEDED','PARTIALLY_REFUNDED')`,
    );
    expect(rows[0].net).toBe(21_000);
  });

  it("refuses dates that collide with another booking", async () => {
    const p = future(10);
    const r = await confirmed(s, p, new Date(p.getTime() + DAY));
    const other = await createUser();
    await hold({ ...s, user: other }, new Date(p.getTime() + 2 * DAY), new Date(p.getTime() + 3 * DAY));
    await expectCode(
      modifyReservation({ reservationId: r.id, actor: actor(), pickupAt: p, returnAt: new Date(p.getTime() + 2.5 * DAY), idempotencyKey: randomUUID(), paymentMethod: FAKE_PAYMENT_METHODS.success }),
      "VEHICLE_UNAVAILABLE",
    );
  });
});

describe("check-out and check-in", () => {
  it("records mileage and fuel, charges late return and fuel to the deposit", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const p = future(10);
    const end = new Date(p.getTime() + 2 * DAY);
    const r = await confirmed(s, p, end);
    await expectCode(checkOut({ reservationId: r.id, staffUserId: admin.id, mileageKm: 10_100, fuelEighths: 8, now: new Date(p.getTime() - 3 * H) }), "POLICY_VIOLATION");
    const out = await checkOut({ reservationId: r.id, staffUserId: admin.id, mileageKm: 10_100, fuelEighths: 8, now: p });
    expect(out.reservation.status).toBe("PICKED_UP");
    expect(out.agreement).toMatchObject({ pickupMileageKm: 10_100, pickupFuelEighths: 8 });

    await createDamageReport({ vehicleId: s.vehicle.id, reservationId: r.id, staffUserId: admin.id, stage: "RETURN", severity: "MINOR", description: "Scratch on rear bumper", chargeFils: 30_000 });
    const back = await checkIn({ reservationId: r.id, staffUserId: admin.id, mileageKm: 10_480, fuelEighths: 6, returnBranchId: s.returnBranch.id, now: new Date(end.getTime() + 2.5 * H) });
    expect(back.charges).toMatchObject({ lateMinutes: 150, lateFeeFils: 15_000, fuelChargeFils: 10_000, damageChargeFils: 30_000, vatFils: 2_750, totalFils: 57_750, capturedFromDepositFils: 57_750, outstandingFils: 0 });
    expect(back.reservation.status).toBe("RETURNED");
    expect(back.agreement).toMatchObject({ returnMileageKm: 10_480, returnFuelEighths: 6 });
    const [v] = await db.select().from(vehicles).where(eq(vehicles.id, s.vehicle.id));
    expect(v).toMatchObject({ status: "AVAILABLE", mileageKm: 10_480, branchId: s.returnBranch.id });
    const [d] = await db.select().from(deposits).where(eq(deposits.reservationId, r.id));
    expect(d).toMatchObject({ status: "PARTIALLY_CAPTURED", capturedFils: 57_750 });
  });
});

describe("releaseExpiredHolds", () => {
  it("expires each lapsed hold exactly once across concurrent runs and refunds money paid", async () => {
    const lapsed = await hold(s, future(10), future(11));
    const p = future(15);
    const fresh = await hold(s, p, new Date(p.getTime() + DAY));
    // Pretend the customer paid the charge just before the hold lapsed (deposit never held).
    await db.insert(payments).values({
      reservationId: lapsed.reservation.id,
      amountFils: lapsed.reservation.totalFils,
      provider: "fake",
      idempotencyKey: randomUUID(),
    });
    const [pay] = await db.select().from(payments).where(eq(payments.reservationId, lapsed.reservation.id));
    const charge = await fake().createCharge({ amountCents: pay.amountFils, currency: "AED", paymentMethod: FAKE_PAYMENT_METHODS.success, idempotencyKey: pay.idempotencyKey });
    await db.update(payments).set({ status: "SUCCEEDED", providerChargeId: charge.id }).where(eq(payments.id, pay.id));

    const now = new Date(Date.now() + 16 * 60_000);
    // Only this test's reservations matter; others may also be lapsed by "now".
    const runs = await Promise.all(Array.from({ length: 5 }, () => releaseExpiredHolds(now)));
    const total = runs.reduce((n, r) => n + r.released, 0);
    expect(total).toBeGreaterThanOrEqual(2);
    const statuses = await db
      .select({ id: reservations.id, status: reservations.status })
      .from(reservations)
      .where(and(eq(reservations.userId, s.user.id)));
    expect(statuses.every((r) => r.status === "EXPIRED")).toBe(true);
    expect(fresh.reservation.id).toBeTruthy();
    const [after] = await db.select().from(payments).where(eq(payments.id, pay.id));
    expect(after.status).toBe("REFUNDED");
    const again = await releaseExpiredHolds(now);
    expect(again).toMatchObject({ released: 0, refundedFils: 0 });
  });
});
