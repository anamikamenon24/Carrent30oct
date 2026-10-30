import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { closeDb } from "@/server/db";
import { computeQuote } from "@/server/pricing";
import { createReservationHold, type CreateHoldInput } from "@/server/reservations/holds";
import { isReservationError, type ReservationErrorCode } from "@/server/reservations/errors";
import { releaseExpiredHolds } from "@/server/jobs/release-expired-holds";
import { testPool, truncateAll } from "./helpers/db";
import { createBranch, createUser, createWorld, insertMaintenance, type World } from "./helpers/fixtures";

// Service-level reservation transaction (brief steps 1-10) on driveeasy_test.

const MIN = 60_000;
const NOW = new Date("2027-03-01T08:00:00+04:00");
const D = (day: number, time = "10:00") => new Date(`2027-03-${String(day).padStart(2, "0")}T${time}:00+04:00`);

let pool: Pool;
let w: World;

beforeAll(() => {
  pool = testPool();
});
afterAll(async () => {
  await pool.end();
  await closeDb?.();
});
beforeEach(async () => {
  await truncateAll(pool);
  w = await createWorld(pool);
});

const hold = (over: Partial<CreateHoldInput> = {}) =>
  createReservationHold({
    userId: w.userId,
    vehicleId: w.vehicleId,
    pickupBranchId: w.branchId,
    returnBranchId: w.branchId,
    pickupAt: D(10),
    returnAt: D(13),
    idempotencyKey: randomUUID(),
    now: NOW,
    ...over,
  });

async function errorCode(p: Promise<unknown>): Promise<ReservationErrorCode | "ok"> {
  try {
    await p;
    return "ok";
  } catch (err) {
    if (isReservationError(err)) return err.code;
    throw err;
  }
}

const count = async (sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows[0].n as number;

describe("two sessions, same vehicle, overlapping dates, same time", () => {
  it("20 concurrent holds: exactly one succeeds, the rest get VEHICLE_UNAVAILABLE quickly", async () => {
    const users = await Promise.all(Array.from({ length: 20 }, () => createUser(pool)));
    const started = Date.now();
    const results = await Promise.all(
      users.map((userId, i) => errorCode(hold({ userId, pickupAt: D(10, `1${i % 10}:00`), returnAt: D(12) }))),
    );
    const elapsed = Date.now() - started;
    expect(results.filter((r) => r === "ok")).toHaveLength(1);
    expect(results.filter((r) => r !== "ok")).toEqual(Array(19).fill("VEHICLE_UNAVAILABLE"));
    expect(elapsed, "losers should not wait on deadlock detection").toBeLessThan(10_000);
    expect(await count(`select count(*)::int n from reservations`)).toBe(1);
  });

  it("two sessions booking different vehicles at once both succeed", async () => {
    const other = await createWorld(pool);
    const [a, b] = await Promise.all([
      errorCode(hold()),
      errorCode(hold({ userId: other.userId, vehicleId: other.vehicleId, pickupBranchId: other.branchId, returnBranchId: other.branchId })),
    ]);
    expect([a, b]).toEqual(["ok", "ok"]);
  });
});

describe("back-to-back rentals", () => {
  it("a rental starting exactly when the previous one ends is accepted", async () => {
    await hold({ pickupAt: D(10), returnAt: D(12) });
    expect(await errorCode(hold({ userId: w.otherUserId, pickupAt: D(12), returnAt: D(14) }))).toBe("ok");
    expect(await errorCode(hold({ userId: w.otherUserId, pickupAt: D(8), returnAt: D(10) }))).toBe("ok");
  });

  it("starting one minute before the previous return is rejected", async () => {
    await hold({ pickupAt: D(10), returnAt: D(12) });
    expect(await errorCode(hold({ userId: w.otherUserId, pickupAt: D(12, "09:59"), returnAt: D(14) }))).toBe("VEHICLE_UNAVAILABLE");
  });

  it("a one-way rental strands the car: the next pick-up must be at the return branch", async () => {
    const auh = await createBranch(pool);
    await hold({ pickupAt: D(10), returnAt: D(12), returnBranchId: auh });
    expect(await errorCode(hold({ userId: w.otherUserId, pickupAt: D(13), returnAt: D(14) }))).toBe("VEHICLE_UNAVAILABLE");
    expect(
      await errorCode(hold({ userId: w.otherUserId, pickupAt: D(13), returnAt: D(14), pickupBranchId: auh, returnBranchId: auh })),
    ).toBe("ok");
  });
});

describe("holds", () => {
  it("expire after the hold time, after which someone else can book", async () => {
    const first = await hold();
    expect(first.reservation.status).toBe("PENDING");
    const ttl = first.reservation.holdExpiresAt!.getTime() - NOW.getTime();
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(120 * MIN);

    const justBefore = new Date(first.reservation.holdExpiresAt!.getTime() - 1_000);
    expect(await errorCode(hold({ userId: w.otherUserId, now: justBefore }))).toBe("VEHICLE_UNAVAILABLE");

    const after = new Date(first.reservation.holdExpiresAt!.getTime() + 1_000);
    expect(await errorCode(hold({ userId: w.otherUserId, now: after }))).toBe("ok");
    const { rows } = await pool.query(`select status from reservations where id = $1`, [first.reservation.id]);
    expect(rows[0].status).toBe("EXPIRED");
  });

  it("releaseExpiredHolds expires lapsed holds only, and a second run releases nothing", async () => {
    const lapsed = await hold({ pickupAt: D(10), returnAt: D(11) });
    // On another vehicle: booking the same vehicle later would lazily expire `lapsed` itself.
    const other = await createWorld(pool);
    const fresh = await hold({
      userId: other.userId, vehicleId: other.vehicleId, pickupBranchId: other.branchId, returnBranchId: other.branchId,
      pickupAt: D(20), returnAt: D(21), now: new Date(NOW.getTime() + 60 * MIN),
    });
    const confirmed = await hold({ pickupAt: D(25), returnAt: D(26) });
    await pool.query(`update reservations set status = 'CONFIRMED', confirmed_at = now() where id = $1`, [confirmed.reservation.id]);

    const runAt = new Date(lapsed.reservation.holdExpiresAt!.getTime() + MIN);
    expect(await releaseExpiredHolds(runAt)).toMatchObject({ released: 1 });
    expect(await releaseExpiredHolds(runAt)).toMatchObject({ released: 0 });

    const { rows } = await pool.query<{ id: string; status: string }>(`select id, status from reservations`);
    const status = Object.fromEntries(rows.map((r) => [r.id, r.status]));
    expect(status[lapsed.reservation.id]).toBe("EXPIRED");
    expect(status[fresh.reservation.id]).toBe("PENDING");
    expect(status[confirmed.reservation.id]).toBe("CONFIRMED");
    expect(await count(`select count(*)::int n from vehicle_occupancy where reservation_id = $1`, [lapsed.reservation.id])).toBe(0);
  });

  it("concurrent releaseExpiredHolds runs release each hold once", async () => {
    const a = await hold({ pickupAt: D(10), returnAt: D(11) });
    await hold({ pickupAt: D(12), returnAt: D(13) });
    const runAt = new Date(a.reservation.holdExpiresAt!.getTime() + MIN);
    const results = await Promise.all(Array.from({ length: 5 }, () => releaseExpiredHolds(runAt)));
    expect(results.reduce((s, r) => s + r.released, 0)).toBe(2);
  });
});

describe("idempotency", () => {
  it("retrying with the same key returns the same reservation and writes nothing new", async () => {
    const key = randomUUID();
    const a = await hold({ idempotencyKey: key });
    const b = await hold({ idempotencyKey: key });
    expect(b.reservation.id).toBe(a.reservation.id);
    expect(b.replayed).toBe(true);
    expect(await count(`select count(*)::int n from reservations`)).toBe(1);
  });

  it("5 concurrent retries with the same key create one reservation", async () => {
    const key = randomUUID();
    const results = await Promise.all(Array.from({ length: 5 }, () => hold({ idempotencyKey: key })));
    expect(new Set(results.map((r) => r.reservation.id)).size).toBe(1);
    expect(await count(`select count(*)::int n from reservations`)).toBe(1);
  });

  it("reusing a key for different dates is rejected", async () => {
    const key = randomUUID();
    await hold({ idempotencyKey: key });
    expect(await errorCode(hold({ idempotencyKey: key, returnAt: D(14) }))).toBe("IDEMPOTENCY_CONFLICT");
  });

  it("the same key from another user is independent", async () => {
    const key = randomUUID();
    await hold({ idempotencyKey: key, pickupAt: D(1), returnAt: D(2) });
    expect(await errorCode(hold({ idempotencyKey: key, userId: w.otherUserId, pickupAt: D(3), returnAt: D(4) }))).toBe("ok");
  });
});

describe("validation and availability rules", () => {
  it("rejects pick-up in the past, under the lead time, and reversed periods", async () => {
    expect(await errorCode(hold({ pickupAt: new Date(NOW.getTime() - MIN), returnAt: D(2) }))).toBe("VALIDATION");
    expect(await errorCode(hold({ pickupAt: new Date(NOW.getTime() + 30 * MIN), returnAt: D(2) }))).toBe("VALIDATION");
    expect(await errorCode(hold({ pickupAt: D(12), returnAt: D(10) }))).toBe("VALIDATION");
  });

  it("rejects pick-up outside branch opening hours", async () => {
    expect(await errorCode(hold({ pickupAt: D(10, "03:00") }))).toBe("BRANCH_CLOSED");
  });

  it("rejects a period covered by a maintenance block", async () => {
    await insertMaintenance(pool, w.vehicleId, D(11).toISOString(), D(12).toISOString());
    expect(await errorCode(hold())).toBe("VEHICLE_UNAVAILABLE");
  });

  it("rejects retired vehicles", async () => {
    await pool.query(`update vehicles set status = 'RETIRED' where id = $1`, [w.vehicleId]);
    expect(await errorCode(hold())).toBe("VEHICLE_NOT_RENTABLE");
  });

  it("rejects unknown ids without leaking database errors", async () => {
    expect(await errorCode(hold({ vehicleId: randomUUID() }))).toBe("NOT_FOUND");
    expect(await errorCode(hold({ vehicleId: "not-a-uuid" }))).toBe("NOT_FOUND");
    expect(await errorCode(hold({ extras: [{ extraId: randomUUID(), quantity: 1 }] }))).toBe("VALIDATION");
  });

  it("prices on the server: stored amounts equal the pricing function's quote", async () => {
    const { reservation } = await hold();
    const q = computeQuote({
      categoryId: w.categoryId,
      baseDailyRateFils: 150_00,
      depositFils: 1000_00,
      pickupBranchId: w.branchId,
      returnBranchId: w.branchId,
      timeZone: "Asia/Dubai",
      pickupAt: D(10),
      returnAt: D(13),
      rules: [],
      extras: [],
    });
    expect(reservation).toMatchObject({
      rentalDays: 3,
      rentalFils: q.rentalFils,
      vatFils: q.vatFils,
      totalFils: q.totalFils,
      depositFils: 1000_00,
      status: "PENDING",
    });
  });
});
