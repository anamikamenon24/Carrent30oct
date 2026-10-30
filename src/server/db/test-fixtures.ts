/**
 * Test fixtures: insert minimal valid rows and return them, so tests do not depend on column details.
 * Every code/plate/VIN/email is random, so fixtures never clash with seed data or each other.
 * For tests only (they write directly to whatever DATABASE_URL points at).
 */
import { randomBytes, randomUUID } from "node:crypto";
import { db, type DbOrTx } from "./index";
import {
  branches,
  driverProfiles,
  extras,
  maintenanceBlocks,
  pricingRules,
  users,
  vehicleCategories,
  vehicles,
} from "./schema";

const tag = (n = 6) => randomBytes(n).toString("hex").toUpperCase().slice(0, n);
const VIN_CHARS = "ABCDEFGHJKLMNPRSTUVWXYZ0123456789";
const vin = () => Array.from(randomBytes(17), (b) => VIN_CHARS[b % VIN_CHARS.length]).join("");

export async function createUser(o: Partial<typeof users.$inferInsert> = {}, conn: DbOrTx = db) {
  const [row] = await conn
    .insert(users)
    .values({ name: "Test User", email: `test-${randomUUID()}@example.test`, role: "CUSTOMER", ...o })
    .returning();
  return row;
}

export async function createBranch(o: Partial<typeof branches.$inferInsert> = {}, conn: DbOrTx = db) {
  const [row] = await conn
    .insert(branches)
    .values({ code: `T-${tag()}`, name: "Test Branch", city: "Dubai", emirate: "Dubai", addressLine: "1 Test Street", timeZone: "Asia/Dubai", is24Hours: true, ...o })
    .returning();
  return row;
}

export async function createCategory(o: Partial<typeof vehicleCategories.$inferInsert> = {}, conn: DbOrTx = db) {
  const [row] = await conn
    .insert(vehicleCategories)
    .values({ code: `T_${tag()}`, name: "Test Category", dailyRateFils: 20_000, depositFils: 100_000, ...o })
    .returning();
  return row;
}

/** Creates the category and branch too when their ids are not given. */
export async function createVehicle(o: Partial<typeof vehicles.$inferInsert> = {}, conn: DbOrTx = db) {
  const categoryId = o.categoryId ?? (await createCategory({}, conn)).id;
  const branchId = o.branchId ?? (await createBranch({}, conn)).id;
  const [row] = await conn
    .insert(vehicles)
    .values({
      plateNumber: `T ${tag(8)}`,
      vin: vin(),
      make: "Testa",
      model: "Model T",
      year: 2025,
      transmission: "AUTOMATIC",
      fuelType: "PETROL",
      seats: 5,
      mileageKm: 10_000,
      ...o,
      categoryId,
      branchId,
    })
    .returning();
  return row;
}

export async function createExtra(o: Partial<typeof extras.$inferInsert> = {}, conn: DbOrTx = db) {
  const [row] = await conn
    .insert(extras)
    .values({ code: `T_${tag()}`, name: "Test Extra", pricing: "PER_DAY", priceFils: 2_500, maxQuantity: 3, ...o })
    .returning();
  return row;
}

export async function createPricingRule(o: typeof pricingRules.$inferInsert, conn: DbOrTx = db) {
  const [row] = await conn.insert(pricingRules).values(o).returning();
  return row;
}

/** A complete, eligible driver profile (licence uploaded, valid until 2035, born 1990). */
export async function createDriverProfile(userId: string, o: Partial<typeof driverProfiles.$inferInsert> = {}, conn: DbOrTx = db) {
  const [row] = await conn
    .insert(driverProfiles)
    .values({
      userId,
      firstName: "Test",
      lastName: "Driver",
      dateOfBirth: "1990-01-01",
      phone: "+971500000000",
      licenceNumber: `L${tag(8)}`,
      licenceCountry: "AE",
      licenceExpiresOn: "2035-12-31",
      licenceFileKey: `licences/${userId}/licence.jpg`,
      ...o,
    })
    .returning();
  return row;
}

export async function createMaintenanceBlock(vehicleId: string, startsAt: Date, endsAt: Date, conn: DbOrTx = db) {
  const [row] = await conn.insert(maintenanceBlocks).values({ vehicleId, startsAt, endsAt, reason: "Test service" }).returning();
  return row;
}

/** Everything needed for a booking: user with driver profile, two branches, a vehicle at the first. */
export async function createBookingScenario(conn: DbOrTx = db) {
  const user = await createUser({}, conn);
  const profile = await createDriverProfile(user.id, {}, conn);
  const pickupBranch = await createBranch({}, conn);
  const returnBranch = await createBranch({}, conn);
  const category = await createCategory({}, conn);
  const vehicle = await createVehicle({ categoryId: category.id, branchId: pickupBranch.id }, conn);
  return { user, profile, pickupBranch, returnBranch, category, vehicle };
}
