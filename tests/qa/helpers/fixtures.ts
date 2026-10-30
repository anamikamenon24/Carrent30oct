import { randomBytes, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";

// Minimal SQL fixtures for constraint-level tests. Service-level tests should prefer the
// engine's own functions; these exist so the database guarantees can be tested on their own.

type Q = Pool | PoolClient;
const hex = (n: number) => randomBytes(n).toString("hex").toUpperCase();
const VIN_CHARS = "ABCDEFGHJKLMNPRSTUVWXYZ0123456789";
const vin = () => Array.from({ length: 17 }, () => VIN_CHARS[Math.floor(Math.random() * VIN_CHARS.length)]).join("");

export async function createUser(q: Q, role: "CUSTOMER" | "ADMIN" = "CUSTOMER") {
  const { rows } = await q.query<{ id: string }>(
    `insert into users (name, email, role) values ($1, $2, $3) returning id`,
    [`QA ${hex(3)}`, `qa-${hex(4).toLowerCase()}@example.test`, role],
  );
  return rows[0].id;
}

export async function createBranch(q: Q, code = `Q${hex(3)}`) {
  const { rows } = await q.query<{ id: string }>(
    `insert into branches (code, name, city, emirate, address_line) values ($1, $2, 'Dubai', 'Dubai', '1 QA Street')
     returning id`,
    [code, `QA ${code}`],
  );
  return rows[0].id;
}

export async function createCategory(q: Q, dailyRateFils = 150_00, depositFils = 1000_00) {
  const { rows } = await q.query<{ id: string }>(
    `insert into vehicle_categories (code, name, daily_rate_fils, deposit_fils) values ($1, $2, $3, $4) returning id`,
    [`qa-${hex(3).toLowerCase()}`, "QA category", dailyRateFils, depositFils],
  );
  return rows[0].id;
}

export async function createVehicle(q: Q, branchId: string, categoryId: string) {
  const { rows } = await q.query<{ id: string }>(
    `insert into vehicles (category_id, branch_id, plate_number, vin, make, model, year, transmission, fuel_type, seats)
     values ($1, $2, $3, $4, 'Toyota', 'Corolla', 2025, 'AUTOMATIC', 'PETROL', 5) returning id`,
    [categoryId, branchId, `QA-${hex(3)}`, vin()],
  );
  return rows[0].id;
}

export interface World {
  userId: string;
  otherUserId: string;
  branchId: string;
  categoryId: string;
  vehicleId: string;
}

export async function createWorld(q: Q): Promise<World> {
  const branchId = await createBranch(q);
  const categoryId = await createCategory(q);
  return {
    userId: await createUser(q),
    otherUserId: await createUser(q),
    branchId,
    categoryId,
    vehicleId: await createVehicle(q, branchId, categoryId),
  };
}

export type ReservationStatus = "PENDING" | "CONFIRMED" | "PICKED_UP" | "RETURNED" | "CANCELLED" | "EXPIRED" | "REFUNDED";

/** Inserts a reservation row directly (bypassing the engine) with self-consistent money columns. */
export async function insertReservation(
  q: Q,
  w: Pick<World, "userId" | "branchId" | "vehicleId">,
  pickupAt: string,
  returnAt: string,
  status: ReservationStatus = "PENDING",
) {
  const { rows } = await q.query<{ id: string }>(
    `insert into reservations (reference, user_id, vehicle_id, pickup_branch_id, return_branch_id, pickup_at, return_at,
       status, hold_expires_at, idempotency_key, rental_days, daily_rate_fils, rental_fils, subtotal_fils,
       vat_bps, vat_fils, total_fils, deposit_fils, price_breakdown, cancelled_at)
     values ($1, $2, $3, $4, $4, $5, $6, $7::reservation_status, now() + interval '15 minutes', $8, 1, 10000, 10000, 10000,
       500, 500, 10500, 100000, '{}'::jsonb, case when $7::text in ('CANCELLED', 'REFUNDED') then now() end)
     returning id`,
    [`QA${hex(4)}`, w.userId, w.vehicleId, w.branchId, pickupAt, returnAt, status, randomUUID()],
  );
  return rows[0].id;
}

export async function insertMaintenance(q: Q, vehicleId: string, startsAt: string, endsAt: string) {
  const { rows } = await q.query<{ id: string }>(
    `insert into maintenance_blocks (vehicle_id, starts_at, ends_at, reason) values ($1, $2, $3, 'QA service')
     returning id`,
    [vehicleId, startsAt, endsAt],
  );
  return rows[0].id;
}

/** Runs fn and returns the SQLSTATE it failed with, or "ok". */
export async function sqlState(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "ok";
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (!code) throw err;
    return code;
  }
}
