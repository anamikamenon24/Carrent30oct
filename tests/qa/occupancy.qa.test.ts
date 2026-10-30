import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { testPool, truncateAll } from "./helpers/db";
import { createWorld, insertMaintenance, insertReservation, sqlState, type World } from "./helpers/fixtures";

// Brief: "the same vehicle can never have two overlapping active reservations or maintenance blocks",
// "reserve the same vehicle for overlapping dates from two sessions at the same time; only one
// succeeds", and "back-to-back rentals where one ends exactly when the next begins".
// These tests hit the database guarantees directly, below any application code.

const EXCLUSION = "23P01";
const D = (day: number, time = "10:00") => `2027-03-${String(day).padStart(2, "0")}T${time}:00+04:00`;

let pool: Pool;
let w: World;

beforeAll(() => {
  pool = testPool();
});
afterAll(async () => {
  await pool.end();
});
beforeEach(async () => {
  await truncateAll(pool);
  w = await createWorld(pool);
});

describe("concurrent overlapping reservations", () => {
  it("exactly one of two simultaneous transactions wins", async () => {
    const a = await pool.connect();
    const b = await pool.connect();
    try {
      await a.query("begin");
      await b.query("begin");
      // Both insert before either commits; B blocks on A's index entry until A commits.
      const insA = insertReservation(a, w, D(10), D(13));
      const insB = insertReservation(b, { ...w, userId: w.otherUserId }, D(11), D(14));
      await insA;
      await a.query("commit");
      const stateB = await sqlState(() => insB);
      await b.query("rollback");
      expect(stateB).toBe(EXCLUSION);
    } finally {
      a.release();
      b.release();
    }
    const { rows } = await pool.query(`select count(*)::int as n from reservations where vehicle_id = $1`, [w.vehicleId]);
    expect(rows[0].n).toBe(1);
  });

  it("20 parallel requests for overlapping periods produce exactly one reservation", async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        sqlState(() => insertReservation(pool, w, D(10, `0${i % 10}:00`), D(12))),
      ),
    );
    expect(results.filter((r) => r === "ok"), results.join(",")).toHaveLength(1);
    // Raw concurrent inserts can lose with a deadlock (40P01) between reservations_no_overlap and
    // the occupancy trigger; the service layer must lock the vehicle row first (see engine tests).
    expect(results.filter((r) => r !== "ok" && r !== EXCLUSION && r !== "40P01"), results.join(",")).toEqual([]);
    const { rows } = await pool.query(`select count(*)::int as n from vehicle_occupancy where vehicle_id = $1`, [w.vehicleId]);
    expect(rows[0].n).toBe(1);
  });
});

describe("period boundaries", () => {
  it("allows back-to-back rentals: one ends at 10:00, the next starts at 10:00", async () => {
    await insertReservation(pool, w, D(1), D(3), "CONFIRMED");
    expect(await sqlState(() => insertReservation(pool, w, D(3), D(5), "CONFIRMED"))).toBe("ok");
    expect(await sqlState(() => insertReservation(pool, w, D(5), D(6)))).toBe("ok");
  });

  it("rejects a one-minute overlap at either end", async () => {
    await insertReservation(pool, w, D(10), D(12), "CONFIRMED");
    expect(await sqlState(() => insertReservation(pool, w, D(8), D(10, "10:01")))).toBe(EXCLUSION);
    expect(await sqlState(() => insertReservation(pool, w, D(11, "09:59"), D(13)))).toBe(EXCLUSION);
    expect(await sqlState(() => insertReservation(pool, w, D(10, "11:00"), D(11)))).toBe(EXCLUSION);
    expect(await sqlState(() => insertReservation(pool, w, D(9), D(13)))).toBe(EXCLUSION);
  });

  it("compares instants, not wall-clock text: the same instant in another offset still conflicts", async () => {
    await insertReservation(pool, w, D(10), D(12), "CONFIRMED");
    // 2027-03-11 06:00Z == 10:00 Dubai.
    expect(await sqlState(() => insertReservation(pool, w, "2027-03-11T06:00:00Z", "2027-03-13T06:00:00Z"))).toBe(EXCLUSION);
    expect(await sqlState(() => insertReservation(pool, w, "2027-03-12T06:00:00Z", "2027-03-13T06:00:00Z"))).toBe("ok");
  });

  it("rejects an empty or reversed period", async () => {
    // 23514 = CHECK violation; 22000 = tstzrange() refuses lower > upper while computing the generated column.
    expect(["23514", "22000"]).toContain(await sqlState(() => insertReservation(pool, w, D(5), D(5))));
    expect(["23514", "22000"]).toContain(await sqlState(() => insertReservation(pool, w, D(6), D(5))));
  });

  it("does not block a different vehicle for the same period", async () => {
    const other = await createWorld(pool);
    await insertReservation(pool, w, D(10), D(12), "CONFIRMED");
    expect(await sqlState(() => insertReservation(pool, { ...w, vehicleId: other.vehicleId }, D(10), D(12)))).toBe("ok");
  });
});

describe("which statuses occupy the vehicle", () => {
  for (const status of ["PENDING", "CONFIRMED", "PICKED_UP"] as const) {
    it(`${status} blocks the period`, async () => {
      await insertReservation(pool, w, D(10), D(12), status);
      expect(await sqlState(() => insertReservation(pool, w, D(11), D(13)))).toBe(EXCLUSION);
    });
  }
  for (const status of ["RETURNED", "CANCELLED", "EXPIRED", "REFUNDED"] as const) {
    it(`${status} frees the period`, async () => {
      await insertReservation(pool, w, D(10), D(12), status);
      expect(await sqlState(() => insertReservation(pool, w, D(11), D(13)))).toBe("ok");
    });
  }

  it("expiring a pending hold frees the vehicle and removes its occupancy row", async () => {
    const id = await insertReservation(pool, w, D(10), D(12), "PENDING");
    await pool.query(`update reservations set status = 'EXPIRED', expired_at = now() where id = $1`, [id]);
    const { rows } = await pool.query(`select 1 from vehicle_occupancy where reservation_id = $1`, [id]);
    expect(rows).toHaveLength(0);
    expect(await sqlState(() => insertReservation(pool, w, D(10), D(12)))).toBe("ok");
  });

  it("re-activating an expired hold that now conflicts is rejected", async () => {
    const id = await insertReservation(pool, w, D(10), D(12), "EXPIRED");
    await insertReservation(pool, w, D(11), D(13), "CONFIRMED");
    expect(
      await sqlState(() => pool.query(`update reservations set status = 'CONFIRMED' where id = $1`, [id])),
    ).toBe(EXCLUSION);
  });

  it("moving a reservation's dates onto another booking is rejected", async () => {
    await insertReservation(pool, w, D(10), D(12), "CONFIRMED");
    const id = await insertReservation(pool, w, D(20), D(22), "CONFIRMED");
    expect(
      await sqlState(() => pool.query(`update reservations set pickup_at = $2, return_at = $3 where id = $1`, [id, D(11), D(21)])),
    ).toBe(EXCLUSION);
    // Extending into its own period is fine.
    expect(
      await sqlState(() => pool.query(`update reservations set return_at = $2 where id = $1`, [id, D(23)])),
    ).toBe("ok");
    const { rows } = await pool.query(`select upper(period) as u from vehicle_occupancy where reservation_id = $1`, [id]);
    expect(new Date(rows[0].u).toISOString()).toBe(new Date(D(23)).toISOString());
  });

  it("moving a reservation to another vehicle re-checks that vehicle", async () => {
    const other = await createWorld(pool);
    await insertReservation(pool, { ...w, vehicleId: other.vehicleId }, D(10), D(12), "CONFIRMED");
    const id = await insertReservation(pool, w, D(10), D(12), "CONFIRMED");
    expect(
      await sqlState(() => pool.query(`update reservations set vehicle_id = $2 where id = $1`, [id, other.vehicleId])),
    ).toBe(EXCLUSION);
  });
});

describe("maintenance blocks", () => {
  it("a maintenance block blocks reservations for that period", async () => {
    await insertMaintenance(pool, w.vehicleId, D(10), D(12));
    expect(await sqlState(() => insertReservation(pool, w, D(11), D(13)))).toBe(EXCLUSION);
    expect(await sqlState(() => insertReservation(pool, w, D(12), D(13)))).toBe("ok");
  });

  it("a maintenance block cannot be placed over an active reservation", async () => {
    await insertReservation(pool, w, D(10), D(12), "CONFIRMED");
    expect(await sqlState(() => insertMaintenance(pool, w.vehicleId, D(11), D(11, "18:00")))).toBe(EXCLUSION);
  });

  it("deleting a maintenance block frees the period", async () => {
    const id = await insertMaintenance(pool, w.vehicleId, D(10), D(12));
    await pool.query(`delete from maintenance_blocks where id = $1`, [id]);
    expect(await sqlState(() => insertReservation(pool, w, D(10), D(12)))).toBe("ok");
  });

  it("extending a maintenance block over a reservation is rejected", async () => {
    await insertReservation(pool, w, D(12), D(14), "CONFIRMED");
    const id = await insertMaintenance(pool, w.vehicleId, D(10), D(12));
    expect(
      await sqlState(() => pool.query(`update maintenance_blocks set ends_at = $2 where id = $1`, [id, D(13)])),
    ).toBe(EXCLUSION);
  });
});

describe("reservation integrity", () => {
  it("rejects money columns that do not add up", async () => {
    const id = await insertReservation(pool, w, D(1), D(2));
    expect(
      await sqlState(() => pool.query(`update reservations set total_fils = total_fils + 1 where id = $1`, [id])),
    ).toBe("23514");
  });

  it("requires a hold expiry on PENDING reservations", async () => {
    const id = await insertReservation(pool, w, D(1), D(2));
    expect(
      await sqlState(() => pool.query(`update reservations set hold_expires_at = null where id = $1`, [id])),
    ).toBe("23514");
  });

  it("rejects duplicate plate numbers and VINs regardless of case", async () => {
    const { rows } = await pool.query(`select plate_number, vin from vehicles where id = $1`, [w.vehicleId]);
    const dup = (plate: string, vin: string) =>
      sqlState(() =>
        pool.query(
          `insert into vehicles (category_id, branch_id, plate_number, vin, make, model, year, transmission, fuel_type, seats)
           values ($1, $2, $3, $4, 'Kia', 'Rio', 2025, 'MANUAL', 'PETROL', 5)`,
          [w.categoryId, w.branchId, plate, vin],
        ),
      );
    expect(await dup(rows[0].plate_number.toLowerCase(), "1HGCM82633A004352")).toBe("23505");
    expect(await dup("QA-UNIQUE-1", rows[0].vin)).toBe("23505");
  });
});
