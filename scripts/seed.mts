// Seeds realistic DriveEasy reference data: UAE branches, categories, features, vehicles, extras,
// pricing rules, an admin and a demo customer. Safe to run repeatedly: existing rows (matched by code,
// VIN, email or rule name) are left as they are.
//   pnpm db:seed                         (DATABASE_URL from .env.local)
//   DATABASE_URL=... pnpm db:seed        (an already-set DATABASE_URL wins over .env.local)
// Optional: SEED_ADMIN_PASSWORD / SEED_CUSTOMER_PASSWORD (defaults below are for local use only).
import { hashPassword } from "better-auth/crypto";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../src/server/db/schema";

const {
  accounts,
  branches,
  extras,
  pricingRules,
  users,
  vehicleCategories,
  vehicleFeatureMap,
  vehicleFeatures,
  vehicles,
} = schema;

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}
if (process.env.VERCEL_ENV === "production" && process.env.ALLOW_PRODUCTION_SEED !== "1") {
  console.error("Refusing to seed production (set ALLOW_PRODUCTION_SEED=1 to override).");
  process.exit(1);
}

const pool = new Pool({ connectionString: url, max: 2 });
const db = drizzle(pool, { schema });
const AED = (n: number) => Math.round(n * 100);

// ---------------------------------------------------------------------------------------------
const branchData = [
  { code: "DXB-APT", name: "Dubai International Airport (T3)", city: "Dubai", emirate: "Dubai", addressLine: "Arrivals Hall, Terminal 3, Dubai International Airport", phone: "+971 4 555 0101", latitude: 25.2532, longitude: 55.3657, is24Hours: true },
  { code: "DXB-MRN", name: "Dubai Marina", city: "Dubai", emirate: "Dubai", addressLine: "Marina Walk, Al Marsa Street, Dubai Marina", phone: "+971 4 555 0102", latitude: 25.0805, longitude: 55.1403, opensAt: "08:00", closesAt: "22:00" },
  { code: "DXB-DTN", name: "Downtown Dubai", city: "Dubai", emirate: "Dubai", addressLine: "Sheikh Mohammed bin Rashid Blvd, Downtown Dubai", phone: "+971 4 555 0103", latitude: 25.1972, longitude: 55.2744, opensAt: "08:00", closesAt: "22:00" },
  { code: "AUH-APT", name: "Zayed International Airport", city: "Abu Dhabi", emirate: "Abu Dhabi", addressLine: "Arrivals, Terminal A, Zayed International Airport", phone: "+971 2 555 0201", latitude: 24.433, longitude: 54.6511, is24Hours: true },
  { code: "AUH-CRN", name: "Abu Dhabi Corniche", city: "Abu Dhabi", emirate: "Abu Dhabi", addressLine: "Corniche Road West, Al Khalidiyah", phone: "+971 2 555 0202", latitude: 24.4764, longitude: 54.3237, opensAt: "08:00", closesAt: "21:00" },
  { code: "SHJ-CTY", name: "Sharjah City Centre", city: "Sharjah", emirate: "Sharjah", addressLine: "Al Wahda Street, Sharjah", phone: "+971 6 555 0301", latitude: 25.3254, longitude: 55.4214, opensAt: "09:00", closesAt: "21:00" },
  { code: "RAK-CTY", name: "Ras Al Khaimah", city: "Ras Al Khaimah", emirate: "Ras Al Khaimah", addressLine: "Al Muntasir Road, Al Nakheel", phone: "+971 7 555 0401", latitude: 25.7895, longitude: 55.9432, opensAt: "09:00", closesAt: "20:00" },
];

const categoryData = [
  { code: "ECONOMY", name: "Economy", description: "Small, efficient city cars.", dailyRateFils: AED(110), depositFils: AED(1000), sortOrder: 1 },
  { code: "COMPACT", name: "Compact", description: "Comfortable hatchbacks and small sedans.", dailyRateFils: AED(145), depositFils: AED(1000), sortOrder: 2 },
  { code: "SEDAN", name: "Mid-size sedan", description: "Roomy sedans for business and family trips.", dailyRateFils: AED(190), depositFils: AED(1500), sortOrder: 3 },
  { code: "SUV", name: "SUV", description: "Space and ground clearance for desert roads.", dailyRateFils: AED(320), depositFils: AED(2500), sortOrder: 4 },
  { code: "VAN", name: "People carrier", description: "Seven and eight seaters for groups.", dailyRateFils: AED(380), depositFils: AED(2500), sortOrder: 5 },
  { code: "LUXURY", name: "Luxury", description: "Premium sedans and SUVs. Drivers must be 25+.", dailyRateFils: AED(850), depositFils: AED(5000), minDriverAge: 25, sortOrder: 6 },
];

const featureData = [
  { code: "AC", name: "Air conditioning", icon: "snowflake" },
  { code: "BLUETOOTH", name: "Bluetooth audio", icon: "bluetooth" },
  { code: "CARPLAY", name: "Apple CarPlay / Android Auto", icon: "smartphone" },
  { code: "REAR_CAMERA", name: "Reversing camera", icon: "camera" },
  { code: "CRUISE", name: "Cruise control", icon: "gauge" },
  { code: "NAV", name: "Built-in navigation", icon: "map" },
  { code: "SUNROOF", name: "Sunroof", icon: "sun" },
  { code: "LEATHER", name: "Leather seats", icon: "armchair" },
  { code: "AWD", name: "All-wheel drive", icon: "mountain" },
  { code: "KEYLESS", name: "Keyless entry", icon: "key" },
];

type Fuel = "PETROL" | "DIESEL" | "HYBRID" | "ELECTRIC";
type V = [cat: string, branch: string, make: string, model: string, year: number, color: string, fuel: Fuel, seats: number, doors: number, luggage: number, km: number, plate: string, features: string[], trans?: "AUTOMATIC" | "MANUAL"];
const vehicleData: V[] = [
  ["ECONOMY", "DXB-APT", "Nissan", "Sunny", 2025, "White", "PETROL", 5, 4, 2, 18_400, "DXB A 21407", ["AC", "BLUETOOTH"]],
  ["ECONOMY", "DXB-MRN", "Toyota", "Yaris", 2025, "Silver", "PETROL", 5, 4, 2, 9_200, "DXB B 31862", ["AC", "BLUETOOTH", "CARPLAY"]],
  ["ECONOMY", "SHJ-CTY", "Kia", "Picanto", 2024, "Red", "PETROL", 4, 5, 1, 27_900, "SHJ 3 45120", ["AC", "BLUETOOTH"], "MANUAL"],
  ["ECONOMY", "AUH-APT", "Hyundai", "Accent", 2025, "Grey", "PETROL", 5, 4, 2, 12_350, "AUH 12 50331", ["AC", "BLUETOOTH", "REAR_CAMERA"]],
  ["COMPACT", "DXB-APT", "Toyota", "Corolla Hybrid", 2026, "White", "HYBRID", 5, 4, 3, 4_100, "DXB C 60214", ["AC", "CARPLAY", "REAR_CAMERA", "CRUISE", "KEYLESS"]],
  ["COMPACT", "DXB-DTN", "Mazda", "3", 2025, "Soul Red", "PETROL", 5, 5, 2, 15_700, "DXB D 70455", ["AC", "CARPLAY", "REAR_CAMERA", "CRUISE"]],
  ["COMPACT", "AUH-CRN", "Volkswagen", "Golf", 2025, "Blue", "PETROL", 5, 5, 2, 21_050, "AUH 5 81236", ["AC", "CARPLAY", "REAR_CAMERA"]],
  ["SEDAN", "DXB-APT", "Toyota", "Camry", 2026, "Black", "HYBRID", 5, 4, 3, 6_800, "DXB E 90117", ["AC", "CARPLAY", "REAR_CAMERA", "CRUISE", "KEYLESS"]],
  ["SEDAN", "AUH-APT", "Honda", "Accord", 2025, "Silver", "PETROL", 5, 4, 3, 19_300, "AUH 7 10542", ["AC", "CARPLAY", "REAR_CAMERA", "CRUISE"]],
  ["SEDAN", "DXB-MRN", "Tesla", "Model 3", 2025, "Pearl White", "ELECTRIC", 5, 4, 2, 11_200, "DXB F 11873", ["AC", "NAV", "REAR_CAMERA", "CRUISE", "KEYLESS", "SUNROOF"]],
  ["SUV", "DXB-APT", "Toyota", "Land Cruiser", 2025, "White", "PETROL", 7, 5, 4, 23_600, "DXB G 12398", ["AC", "CARPLAY", "REAR_CAMERA", "CRUISE", "AWD", "LEATHER", "NAV"]],
  ["SUV", "DXB-DTN", "Nissan", "Patrol", 2026, "Champagne", "PETROL", 7, 5, 4, 3_900, "DXB H 13054", ["AC", "CARPLAY", "REAR_CAMERA", "AWD", "LEATHER", "SUNROOF"]],
  ["SUV", "AUH-APT", "Hyundai", "Tucson", 2025, "Grey", "PETROL", 5, 5, 3, 16_450, "AUH 9 14671", ["AC", "CARPLAY", "REAR_CAMERA", "AWD"]],
  ["SUV", "RAK-CTY", "Mitsubishi", "Pajero", 2024, "White", "PETROL", 7, 5, 3, 41_200, "RAK B 15520", ["AC", "BLUETOOTH", "AWD"]],
  ["VAN", "DXB-APT", "Toyota", "Innova", 2025, "Silver", "PETROL", 8, 5, 3, 22_700, "DXB J 16789", ["AC", "BLUETOOTH", "REAR_CAMERA"]],
  ["VAN", "SHJ-CTY", "Kia", "Carnival", 2026, "Black", "PETROL", 7, 5, 4, 5_300, "SHJ 2 17905", ["AC", "CARPLAY", "REAR_CAMERA", "KEYLESS"]],
  ["LUXURY", "DXB-APT", "Mercedes-Benz", "E 300", 2026, "Obsidian Black", "PETROL", 5, 4, 3, 2_800, "DXB K 18240", ["AC", "CARPLAY", "NAV", "LEATHER", "SUNROOF", "KEYLESS", "CRUISE"]],
  ["LUXURY", "DXB-DTN", "Range Rover", "Sport", 2025, "Santorini Black", "PETROL", 5, 5, 3, 8_950, "DXB L 19376", ["AC", "CARPLAY", "NAV", "LEATHER", "SUNROOF", "AWD", "KEYLESS"]],
];

const extraData = [
  { code: "FULL_INSURANCE", name: "Full insurance cover", description: "Zero excess for damage and theft.", pricing: "PER_DAY" as const, priceFils: AED(60), maxQuantity: 1, sortOrder: 1 },
  { code: "CHILD_SEAT", name: "Child seat", description: "Group 1 seat for children 9-18 kg.", pricing: "PER_DAY" as const, priceFils: AED(25), maxQuantity: 3, sortOrder: 2 },
  { code: "GPS", name: "GPS navigation", description: "Portable sat-nav with UAE maps.", pricing: "PER_DAY" as const, priceFils: AED(15), maxQuantity: 1, sortOrder: 3 },
  { code: "ADDITIONAL_DRIVER", name: "Additional driver", description: "Each extra driver must show a valid licence at pick-up.", pricing: "PER_DAY" as const, priceFils: AED(30), maxQuantity: 3, sortOrder: 4 },
  { code: "PREPAID_FUEL", name: "Prepaid full tank", description: "Return the car at any fuel level.", pricing: "PER_RENTAL" as const, priceFils: AED(180), maxQuantity: 1, sortOrder: 5 },
];

// VINs avoid I, O and Q as the standard requires.
const vinFor = (make: string, i: number) =>
  (make.replace(/[^A-Z]/gi, "").toUpperCase().replace(/[IOQ]/g, "X") + "XXX").slice(0, 3) + "DESEED" + "A" + String(100_000 + i).padStart(7, "0");

async function upsertUser(email: string, name: string, role: "ADMIN" | "CUSTOMER", password: string) {
  const [existing] = await db.select().from(users).where(eq(users.email, email));
  if (existing) return { user: existing, created: false };
  const [user] = await db.insert(users).values({ email, name, role, emailVerified: true }).returning();
  await db.insert(accounts).values({
    userId: user.id,
    accountId: user.id,
    providerId: "credential",
    password: await hashPassword(password),
  });
  return { user, created: true };
}

async function main() {
  const target = new URL(url!);
  console.log(`Seeding ${target.hostname}:${target.port}${target.pathname}`);

  await db.insert(branches).values(branchData).onConflictDoNothing();
  await db.insert(vehicleCategories).values(categoryData).onConflictDoNothing();
  await db.insert(vehicleFeatures).values(featureData).onConflictDoNothing();
  await db.insert(extras).values(extraData).onConflictDoNothing();

  const branchId = Object.fromEntries((await db.select().from(branches)).map((b) => [b.code, b.id]));
  const categoryId = Object.fromEntries((await db.select().from(vehicleCategories)).map((c) => [c.code, c.id]));
  const featureId = Object.fromEntries((await db.select().from(vehicleFeatures)).map((f) => [f.code, f.id]));

  let newVehicles = 0;
  for (const [i, [cat, branch, make, model, year, color, fuel, seats, doors, luggage, km, plate, feats, trans]] of vehicleData.entries()) {
    const vin = vinFor(make, i);
    const [existing] = await db.select({ id: vehicles.id }).from(vehicles).where(eq(vehicles.vin, vin));
    if (existing) continue;
    const [v] = await db
      .insert(vehicles)
      .values({
        categoryId: categoryId[cat],
        branchId: branchId[branch],
        plateNumber: plate,
        vin,
        make,
        model,
        year,
        color,
        transmission: trans ?? "AUTOMATIC",
        fuelType: fuel,
        seats,
        doors,
        luggage,
        mileageKm: km,
        description: `${year} ${make} ${model} in ${color.toLowerCase()}.`,
      })
      .onConflictDoNothing()
      .returning({ id: vehicles.id });
    if (!v) continue;
    newVehicles++;
    await db.insert(vehicleFeatureMap).values(feats.map((f) => ({ vehicleId: v.id, featureId: featureId[f] })));
  }

  const rules: (typeof pricingRules.$inferInsert)[] = [
    { name: "One-way fee (standard)", type: "ONE_WAY_FEE", amountFils: AED(250) },
    { name: "One-way Dubai Airport -> Abu Dhabi Airport", type: "ONE_WAY_FEE", pickupBranchId: branchId["DXB-APT"], returnBranchId: branchId["AUH-APT"], amountFils: AED(200) },
    { name: "One-way Abu Dhabi Airport -> Dubai Airport", type: "ONE_WAY_FEE", pickupBranchId: branchId["AUH-APT"], returnBranchId: branchId["DXB-APT"], amountFils: AED(200) },
    { name: "One-way return to Ras Al Khaimah", type: "ONE_WAY_FEE", returnBranchId: branchId["RAK-CTY"], amountFils: AED(350) },
    { name: "One-way within Dubai (Airport -> Marina)", type: "ONE_WAY_FEE", pickupBranchId: branchId["DXB-APT"], returnBranchId: branchId["DXB-MRN"], amountFils: AED(75) },
    { name: "Winter peak season", type: "SEASONAL", validFrom: "2026-12-15", validTo: "2027-01-05", adjustmentBps: 2_000, priority: 10 },
    { name: "Eid Al Fitr", type: "SEASONAL", validFrom: "2027-03-08", validTo: "2027-03-13", adjustmentBps: 1_500, priority: 20 },
    { name: "Summer saver", type: "SEASONAL", validFrom: "2027-06-15", validTo: "2027-08-31", adjustmentBps: -1_500, priority: 5 },
    { name: "Luxury New Year surcharge", type: "SEASONAL", categoryId: categoryId["LUXURY"], validFrom: "2026-12-30", validTo: "2027-01-02", adjustmentBps: 3_500, priority: 30 },
    { name: "Weekly discount (7+ days)", type: "DURATION_DISCOUNT", minDays: 7, adjustmentBps: -1_000 },
    { name: "Monthly discount (28+ days)", type: "DURATION_DISCOUNT", minDays: 28, adjustmentBps: -2_500 },
  ];
  for (const rule of rules) {
    const [existing] = await db.select({ id: pricingRules.id }).from(pricingRules).where(and(eq(pricingRules.name, rule.name)));
    if (!existing) await db.insert(pricingRules).values(rule);
  }

  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "DriveEasyAdmin!2026";
  const customerPassword = process.env.SEED_CUSTOMER_PASSWORD ?? "DriveEasyDemo!2026";
  const admin = await upsertUser("admin@driveeasy.local", "DriveEasy Admin", "ADMIN", adminPassword);
  const customer = await upsertUser("customer@driveeasy.local", "Layla Haddad", "CUSTOMER", customerPassword);

  const count = async (t: Parameters<typeof db.$count>[0]) => db.$count(t);
  console.log(
    `Done. branches=${await count(branches)} categories=${await count(vehicleCategories)} vehicles=${await count(vehicles)} (+${newVehicles} new) extras=${await count(extras)} pricing_rules=${await count(pricingRules)}`,
  );
  console.log(`Branch codes: ${branchData.map((b) => b.code).join(", ")}`);
  console.log(`Extra codes:  ${extraData.map((e) => e.code).join(", ")}`);
  console.log(`Admin:    admin@driveeasy.local / ${admin.created ? adminPassword : "(existing account, password unchanged)"}`);
  console.log(`Customer: customer@driveeasy.local / ${customer.created ? customerPassword : "(existing account, password unchanged)"}`);
}

try {
  await main();
} finally {
  await pool.end();
}
