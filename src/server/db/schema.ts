/**
 * DriveEasy database schema (Drizzle ORM, PostgreSQL).
 *
 * Conventions
 * - UUID primary keys (gen_random_uuid()).
 * - Every timestamp is `timestamptz` and holds UTC instants; display in the branch's `time_zone`.
 * - Money is integer minor units: fils for AED (1 AED = 100 fils). Columns end in `_fils`.
 * - Rental periods are `tstzrange` values with '[)' bounds, so back-to-back rentals do not overlap.
 *
 * Things Drizzle cannot express (btree_gist, exclusion constraints, occupancy triggers) live in the
 * hand-written migration drizzle/0002_occupancy_constraints.sql. After changing this file run
 * `pnpm db:generate` and review the SQL.
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  customType,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  smallint,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------------------------
// Column helpers
// ---------------------------------------------------------------------------------------------

/** A PostgreSQL tstzrange, read and written in its text form, e.g. `["2026-11-01 08:00:00+00","2026-11-03 08:00:00+00")`. */
export const tstzrange = customType<{ data: string; driverData: string }>({
  dataType: () => "tstzrange",
});

const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => tstz("created_at").notNull().defaultNow();
const updatedAt = () =>
  tstz("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

// ---------------------------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------------------------

export const userRole = pgEnum("user_role", ["CUSTOMER", "ADMIN"]);
export const vehicleStatus = pgEnum("vehicle_status", ["AVAILABLE", "RESERVED", "ON_RENT", "MAINTENANCE", "RETIRED"]);
export const reservationStatus = pgEnum("reservation_status", [
  "PENDING",
  "CONFIRMED",
  "PICKED_UP",
  "RETURNED",
  "CANCELLED",
  "EXPIRED",
  "REFUNDED",
]);
/** Reservation statuses that occupy the vehicle (enforced by the exclusion constraints). */
export const ACTIVE_RESERVATION_STATUSES = ["PENDING", "CONFIRMED", "PICKED_UP"] as const;

export const paymentStatus = pgEnum("payment_status", [
  "PENDING",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
  "PARTIALLY_REFUNDED",
  "REFUNDED",
]);
export const paymentKind = pgEnum("payment_kind", ["RENTAL", "MODIFICATION", "RETURN_CHARGES"]);
export const depositStatus = pgEnum("deposit_status", [
  "PENDING",
  "HELD",
  "FAILED",
  "RELEASED",
  "PARTIALLY_CAPTURED",
  "CAPTURED",
]);
export const transmission = pgEnum("transmission", ["AUTOMATIC", "MANUAL"]);
export const fuelType = pgEnum("fuel_type", ["PETROL", "DIESEL", "HYBRID", "ELECTRIC"]);
export const extraPricing = pgEnum("extra_pricing", ["PER_DAY", "PER_RENTAL"]);
export const pricingRuleType = pgEnum("pricing_rule_type", ["SEASONAL", "DURATION_DISCOUNT", "ONE_WAY_FEE"]);
export const damageSeverity = pgEnum("damage_severity", ["MINOR", "MODERATE", "MAJOR"]);
export const damageStage = pgEnum("damage_stage", ["PICKUP", "RETURN", "OTHER"]);
export const damageStatus = pgEnum("damage_status", ["OPEN", "CHARGED", "WAIVED", "REPAIRED"]);
export const occupancyKind = pgEnum("occupancy_kind", ["RESERVATION", "MAINTENANCE"]);

// ---------------------------------------------------------------------------------------------
// Auth (Better Auth tables; property names follow Better Auth's field names)
// ---------------------------------------------------------------------------------------------

export const users = pgTable(
  "users",
  {
    id: id(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    role: userRole("role").notNull().default("CUSTOMER"),
    phone: text("phone"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("users_email_unique").on(sql`lower(${t.email})`)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    expiresAt: tstz("expires_at").notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const accounts = pgTable(
  "accounts",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: tstz("access_token_expires_at"),
    refreshTokenExpiresAt: tstz("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("accounts_user_idx").on(t.userId),
    uniqueIndex("accounts_provider_account_unique").on(t.providerId, t.accountId),
  ],
);

export const verifications = pgTable(
  "verifications",
  {
    id: id(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: tstz("expires_at").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("verifications_identifier_idx").on(t.identifier)],
);

/** Better Auth rate-limit storage (shared across serverless instances). */
export const rateLimits = pgTable("rate_limits", {
  id: id(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull().default(0),
  lastRequest: bigint("last_request", { mode: "number" }).notNull(),
});

// ---------------------------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------------------------

export const driverProfiles = pgTable(
  "driver_profiles",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: "cascade" }),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    dateOfBirth: date("date_of_birth", { mode: "string" }).notNull(),
    phone: text("phone").notNull(),
    nationality: text("nationality"),
    addressLine: text("address_line"),
    city: text("city"),
    country: text("country"),
    licenceNumber: text("licence_number").notNull(),
    licenceCountry: text("licence_country").notNull(),
    licenceIssuedOn: date("licence_issued_on", { mode: "string" }),
    licenceExpiresOn: date("licence_expires_on", { mode: "string" }).notNull(),
    /** Private storage key of the uploaded licence image (never a public URL). */
    licenceFileKey: text("licence_file_key"),
    licenceVerifiedAt: tstz("licence_verified_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("driver_profiles_names_check", sql`length(trim(${t.firstName})) > 0 and length(trim(${t.lastName})) > 0`),
    check("driver_profiles_licence_dates_check", sql`${t.licenceIssuedOn} is null or ${t.licenceIssuedOn} < ${t.licenceExpiresOn}`),
    check("driver_profiles_dob_check", sql`${t.dateOfBirth} > date '1900-01-01'`),
  ],
);

// ---------------------------------------------------------------------------------------------
// Branches and fleet
// ---------------------------------------------------------------------------------------------

export const branches = pgTable(
  "branches",
  {
    id: id(),
    code: text("code").notNull().unique("branches_code_unique"),
    name: text("name").notNull(),
    city: text("city").notNull(),
    emirate: text("emirate").notNull(),
    addressLine: text("address_line").notNull(),
    phone: text("phone"),
    email: text("email"),
    /** IANA time zone used to display times and to check opening hours, e.g. "Asia/Dubai". */
    timeZone: text("time_zone").notNull().default("Asia/Dubai"),
    latitude: numeric("latitude", { precision: 9, scale: 6, mode: "number" }),
    longitude: numeric("longitude", { precision: 9, scale: 6, mode: "number" }),
    /** Local opening hours. Ignored when `is24Hours`. */
    opensAt: time("opens_at").notNull().default("08:00"),
    closesAt: time("closes_at").notNull().default("22:00"),
    is24Hours: boolean("is_24_hours").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("branches_code_format", sql`${t.code} ~ '^[A-Z0-9-]{2,16}$'`),
    check("branches_hours_check", sql`${t.is24Hours} or ${t.opensAt} < ${t.closesAt}`),
    check("branches_lat_check", sql`${t.latitude} is null or ${t.latitude} between -90 and 90`),
    check("branches_lng_check", sql`${t.longitude} is null or ${t.longitude} between -180 and 180`),
  ],
);

export const vehicleCategories = pgTable(
  "vehicle_categories",
  {
    id: id(),
    code: text("code").notNull().unique(),
    name: text("name").notNull(),
    description: text("description"),
    dailyRateFils: integer("daily_rate_fils").notNull(),
    depositFils: integer("deposit_fils").notNull(),
    /** Minimum driver age for this category. */
    minDriverAge: smallint("min_driver_age").notNull().default(21),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("vehicle_categories_rate_check", sql`${t.dailyRateFils} > 0`),
    check("vehicle_categories_deposit_check", sql`${t.depositFils} >= 0`),
    check("vehicle_categories_age_check", sql`${t.minDriverAge} between 18 and 99`),
  ],
);

export const vehicles = pgTable(
  "vehicles",
  {
    id: id(),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => vehicleCategories.id, { onDelete: "restrict" }),
    /** Where the vehicle is now (updated at check-in for one-way rentals). */
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "restrict" }),
    plateNumber: text("plate_number").notNull(),
    vin: text("vin").notNull(),
    make: text("make").notNull(),
    model: text("model").notNull(),
    year: smallint("year").notNull(),
    color: text("color"),
    transmission: transmission("transmission").notNull(),
    fuelType: fuelType("fuel_type").notNull(),
    seats: smallint("seats").notNull(),
    doors: smallint("doors").notNull().default(4),
    luggage: smallint("luggage").notNull().default(2),
    mileageKm: integer("mileage_km").notNull().default(0),
    /** Overrides the category's daily rate when set. */
    dailyRateFils: integer("daily_rate_fils"),
    status: vehicleStatus("status").notNull().default("AVAILABLE"),
    /** Storage keys or absolute URLs of public vehicle photos, first one is the cover. */
    photos: text("photos").array().notNull().default(sql`'{}'::text[]`),
    description: text("description"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("vehicles_plate_number_unique").on(sql`upper(${t.plateNumber})`),
    uniqueIndex("vehicles_vin_unique").on(sql`upper(${t.vin})`),
    index("vehicles_branch_status_idx").on(t.branchId, t.status),
    index("vehicles_category_idx").on(t.categoryId),
    check("vehicles_vin_format", sql`${t.vin} ~ '^[A-HJ-NPR-Z0-9]{17}$'`),
    check("vehicles_year_check", sql`${t.year} between 1990 and 2100`),
    check("vehicles_seats_check", sql`${t.seats} between 1 and 15`),
    check("vehicles_doors_check", sql`${t.doors} between 2 and 6`),
    check("vehicles_luggage_check", sql`${t.luggage} between 0 and 12`),
    check("vehicles_mileage_check", sql`${t.mileageKm} >= 0`),
    check("vehicles_rate_check", sql`${t.dailyRateFils} is null or ${t.dailyRateFils} > 0`),
  ],
);

export const vehicleFeatures = pgTable("vehicle_features", {
  id: id(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  icon: text("icon"),
  createdAt: createdAt(),
});

export const vehicleFeatureMap = pgTable(
  "vehicle_feature_map",
  {
    id: id(),
    vehicleId: uuid("vehicle_id")
      .notNull()
      .references(() => vehicles.id, { onDelete: "cascade" }),
    featureId: uuid("feature_id")
      .notNull()
      .references(() => vehicleFeatures.id, { onDelete: "cascade" }),
  },
  (t) => [
    uniqueIndex("vehicle_feature_map_unique").on(t.vehicleId, t.featureId),
    index("vehicle_feature_map_feature_idx").on(t.featureId),
  ],
);

// ---------------------------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------------------------

/**
 * - SEASONAL: adjusts the daily rate by `adjustment_bps` (e.g. 2000 = +20%, -1000 = -10%) for each rental
 *   day whose local date is within [valid_from, valid_to]. Highest priority wins if several match.
 * - DURATION_DISCOUNT: takes `adjustment_bps` (negative) off the rental when days >= `min_days`.
 *   The matching rule with the largest min_days wins.
 * - ONE_WAY_FEE: `amount_fils` when pick-up and return branches differ. A rule with both branches set
 *   beats one with one branch set, which beats a catch-all rule.
 * `category_id` null means "all categories".
 */
export const pricingRules = pgTable(
  "pricing_rules",
  {
    id: id(),
    name: text("name").notNull(),
    type: pricingRuleType("type").notNull(),
    categoryId: uuid("category_id").references(() => vehicleCategories.id, { onDelete: "cascade" }),
    pickupBranchId: uuid("pickup_branch_id").references(() => branches.id, { onDelete: "cascade" }),
    returnBranchId: uuid("return_branch_id").references(() => branches.id, { onDelete: "cascade" }),
    validFrom: date("valid_from", { mode: "string" }),
    validTo: date("valid_to", { mode: "string" }),
    minDays: integer("min_days"),
    adjustmentBps: integer("adjustment_bps"),
    amountFils: integer("amount_fils"),
    priority: integer("priority").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("pricing_rules_type_idx").on(t.type, t.isActive),
    index("pricing_rules_category_idx").on(t.categoryId),
    index("pricing_rules_pickup_branch_idx").on(t.pickupBranchId),
    index("pricing_rules_return_branch_idx").on(t.returnBranchId),
    check("pricing_rules_dates_check", sql`${t.validFrom} is null or ${t.validTo} is null or ${t.validFrom} <= ${t.validTo}`),
    check(
      "pricing_rules_shape_check",
      sql`case ${t.type}
        when 'SEASONAL' then ${t.adjustmentBps} is not null and ${t.adjustmentBps} between -9000 and 30000
          and ${t.validFrom} is not null and ${t.validTo} is not null
        when 'DURATION_DISCOUNT' then ${t.adjustmentBps} is not null and ${t.adjustmentBps} between -9000 and 0
          and ${t.minDays} is not null and ${t.minDays} >= 2
        when 'ONE_WAY_FEE' then ${t.amountFils} is not null and ${t.amountFils} >= 0
          and (${t.pickupBranchId} is null or ${t.returnBranchId} is null or ${t.pickupBranchId} <> ${t.returnBranchId})
      end`,
    ),
  ],
);

export const extras = pgTable(
  "extras",
  {
    id: id(),
    code: text("code").notNull().unique(),
    name: text("name").notNull(),
    description: text("description"),
    pricing: extraPricing("pricing").notNull(),
    priceFils: integer("price_fils").notNull(),
    maxQuantity: smallint("max_quantity").notNull().default(1),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("extras_price_check", sql`${t.priceFils} >= 0`),
    check("extras_max_quantity_check", sql`${t.maxQuantity} between 1 and 10`),
  ],
);

// ---------------------------------------------------------------------------------------------
// Reservations
// ---------------------------------------------------------------------------------------------

export const reservations = pgTable(
  "reservations",
  {
    id: id(),
    /** Human-friendly reference printed on the voucher, e.g. "DE-7K3M9Q". */
    reference: text("reference").notNull().unique(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    vehicleId: uuid("vehicle_id")
      .notNull()
      .references(() => vehicles.id, { onDelete: "restrict" }),
    pickupBranchId: uuid("pickup_branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "restrict" }),
    returnBranchId: uuid("return_branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "restrict" }),
    driverProfileId: uuid("driver_profile_id").references(() => driverProfiles.id, { onDelete: "set null" }),
    pickupAt: tstz("pickup_at").notNull(),
    returnAt: tstz("return_at").notNull(),
    period: tstzrange("period")
      .notNull()
      .generatedAlwaysAs(sql`tstzrange(pickup_at, return_at, '[)')`),
    status: reservationStatus("status").notNull().default("PENDING"),
    /** When an unpaid PENDING reservation stops holding the vehicle. Null once confirmed. */
    holdExpiresAt: tstz("hold_expires_at"),
    /** Client-supplied key; retrying the same request returns the same reservation. */
    idempotencyKey: text("idempotency_key").notNull(),

    currency: text("currency").notNull().default("AED"),
    rentalDays: integer("rental_days").notNull(),
    dailyRateFils: integer("daily_rate_fils").notNull(),
    rentalFils: integer("rental_fils").notNull(),
    discountFils: integer("discount_fils").notNull().default(0),
    extrasFils: integer("extras_fils").notNull().default(0),
    oneWayFeeFils: integer("one_way_fee_fils").notNull().default(0),
    subtotalFils: integer("subtotal_fils").notNull(),
    vatBps: integer("vat_bps").notNull(),
    vatFils: integer("vat_fils").notNull(),
    totalFils: integer("total_fils").notNull(),
    depositFils: integer("deposit_fils").notNull(),
    /** Full quote (per-day rates, rules applied) as computed on the server. */
    priceBreakdown: jsonb("price_breakdown").notNull(),

    confirmedAt: tstz("confirmed_at"),
    cancelledAt: tstz("cancelled_at"),
    cancellationReason: text("cancellation_reason"),
    cancellationFeeFils: integer("cancellation_fee_fils"),
    refundedFils: integer("refunded_fils").notNull().default(0),
    expiredAt: tstz("expired_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("reservations_user_idempotency_unique").on(t.userId, t.idempotencyKey),
    index("reservations_user_idx").on(t.userId, t.pickupAt),
    index("reservations_vehicle_idx").on(t.vehicleId, t.pickupAt),
    index("reservations_pickup_branch_idx").on(t.pickupBranchId),
    index("reservations_return_branch_idx").on(t.returnBranchId),
    index("reservations_driver_profile_idx").on(t.driverProfileId),
    index("reservations_status_idx").on(t.status, t.pickupAt),
    index("reservations_pending_hold_idx")
      .on(t.holdExpiresAt)
      .where(sql`${t.status} = 'PENDING'`),
    check("reservations_period_check", sql`${t.returnAt} > ${t.pickupAt}`),
    check("reservations_currency_check", sql`${t.currency} = 'AED'`),
    check("reservations_hold_check", sql`${t.status} <> 'PENDING' or ${t.holdExpiresAt} is not null`),
    check(
      "reservations_money_check",
      sql`${t.rentalDays} >= 1 and ${t.dailyRateFils} > 0 and ${t.rentalFils} >= 0 and ${t.discountFils} >= 0
        and ${t.extrasFils} >= 0 and ${t.oneWayFeeFils} >= 0 and ${t.vatBps} >= 0 and ${t.vatFils} >= 0
        and ${t.depositFils} >= 0 and ${t.refundedFils} >= 0
        and ${t.subtotalFils} = ${t.rentalFils} - ${t.discountFils} + ${t.extrasFils} + ${t.oneWayFeeFils}
        and ${t.totalFils} = ${t.subtotalFils} + ${t.vatFils}`,
    ),
    check(
      "reservations_cancel_check",
      sql`(${t.status} in ('CANCELLED', 'REFUNDED')) = (${t.cancelledAt} is not null)`,
    ),
  ],
);

export const reservationExtras = pgTable(
  "reservation_extras",
  {
    id: id(),
    reservationId: uuid("reservation_id")
      .notNull()
      .references(() => reservations.id, { onDelete: "cascade" }),
    extraId: uuid("extra_id")
      .notNull()
      .references(() => extras.id, { onDelete: "restrict" }),
    quantity: smallint("quantity").notNull(),
    pricing: extraPricing("pricing").notNull(),
    unitPriceFils: integer("unit_price_fils").notNull(),
    totalFils: integer("total_fils").notNull(),
  },
  (t) => [
    uniqueIndex("reservation_extras_unique").on(t.reservationId, t.extraId),
    index("reservation_extras_extra_idx").on(t.extraId),
    check("reservation_extras_quantity_check", sql`${t.quantity} between 1 and 10`),
    check("reservation_extras_money_check", sql`${t.unitPriceFils} >= 0 and ${t.totalFils} >= 0`),
  ],
);

// ---------------------------------------------------------------------------------------------
// Payments and deposits (statuses are separate from the reservation status)
// ---------------------------------------------------------------------------------------------

export const payments = pgTable(
  "payments",
  {
    id: id(),
    reservationId: uuid("reservation_id")
      .notNull()
      .references(() => reservations.id, { onDelete: "restrict" }),
    kind: paymentKind("kind").notNull().default("RENTAL"),
    status: paymentStatus("status").notNull().default("PENDING"),
    amountFils: integer("amount_fils").notNull(),
    refundedFils: integer("refunded_fils").notNull().default(0),
    currency: text("currency").notNull().default("AED"),
    provider: text("provider").notNull(),
    providerChargeId: text("provider_charge_id").unique(),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    failureReason: text("failure_reason"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("payments_reservation_idx").on(t.reservationId),
    check("payments_amount_check", sql`${t.amountFils} > 0 and ${t.refundedFils} between 0 and ${t.amountFils}`),
    check("payments_currency_check", sql`${t.currency} = 'AED'`),
  ],
);

export const deposits = pgTable(
  "deposits",
  {
    id: id(),
    reservationId: uuid("reservation_id")
      .notNull()
      .references(() => reservations.id, { onDelete: "restrict" }),
    status: depositStatus("status").notNull().default("PENDING"),
    amountFils: integer("amount_fils").notNull(),
    capturedFils: integer("captured_fils").notNull().default(0),
    currency: text("currency").notNull().default("AED"),
    provider: text("provider").notNull(),
    providerHoldId: text("provider_hold_id").unique(),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    failureReason: text("failure_reason"),
    heldAt: tstz("held_at"),
    releasedAt: tstz("released_at"),
    capturedAt: tstz("captured_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("deposits_reservation_idx").on(t.reservationId),
    // At most one live (pending or held) deposit per reservation.
    uniqueIndex("deposits_one_live_per_reservation")
      .on(t.reservationId)
      .where(sql`${t.status} in ('PENDING', 'HELD')`),
    check("deposits_amount_check", sql`${t.amountFils} > 0 and ${t.capturedFils} between 0 and ${t.amountFils}`),
    check("deposits_currency_check", sql`${t.currency} = 'AED'`),
  ],
);

/** Payment-provider webhook events already processed; the primary key makes duplicate deliveries no-ops. */
export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: id(),
    provider: text("provider").notNull(),
    eventId: text("event_id").notNull(),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull(),
    receivedAt: tstz("received_at").notNull().defaultNow(),
    processedAt: tstz("processed_at"),
  },
  (t) => [uniqueIndex("webhook_events_provider_event_unique").on(t.provider, t.eventId)],
);

// ---------------------------------------------------------------------------------------------
// Rental operations
// ---------------------------------------------------------------------------------------------

export const rentalAgreements = pgTable(
  "rental_agreements",
  {
    id: id(),
    reservationId: uuid("reservation_id")
      .notNull()
      .unique()
      .references(() => reservations.id, { onDelete: "restrict" }),
    agreementNumber: text("agreement_number").notNull().unique(),
    checkedOutBy: uuid("checked_out_by").references(() => users.id, { onDelete: "set null" }),
    checkedOutAt: tstz("checked_out_at").notNull().defaultNow(),
    pickupMileageKm: integer("pickup_mileage_km").notNull(),
    /** Fuel level in eighths of a tank (0 = empty, 8 = full). */
    pickupFuelEighths: smallint("pickup_fuel_eighths").notNull(),
    pickupNotes: text("pickup_notes"),
    checkedInBy: uuid("checked_in_by").references(() => users.id, { onDelete: "set null" }),
    returnedAt: tstz("returned_at"),
    returnBranchId: uuid("return_branch_id").references(() => branches.id, { onDelete: "restrict" }),
    returnMileageKm: integer("return_mileage_km"),
    returnFuelEighths: smallint("return_fuel_eighths"),
    returnNotes: text("return_notes"),
    lateMinutes: integer("late_minutes"),
    lateFeeFils: integer("late_fee_fils"),
    fuelChargeFils: integer("fuel_charge_fils"),
    damageChargeFils: integer("damage_charge_fils"),
    returnVatFils: integer("return_vat_fils"),
    returnChargesFils: integer("return_charges_fils"),
    /** Part of the return charges that the deposit did not cover and is still owed. */
    outstandingFils: integer("outstanding_fils"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("rental_agreements_return_branch_idx").on(t.returnBranchId),
    index("rental_agreements_checked_out_by_idx").on(t.checkedOutBy),
    index("rental_agreements_checked_in_by_idx").on(t.checkedInBy),
    check("rental_agreements_pickup_check", sql`${t.pickupMileageKm} >= 0 and ${t.pickupFuelEighths} between 0 and 8`),
    check(
      "rental_agreements_return_check",
      sql`(${t.returnedAt} is null and ${t.returnMileageKm} is null and ${t.returnFuelEighths} is null)
        or (${t.returnedAt} is not null and ${t.returnMileageKm} >= ${t.pickupMileageKm}
            and ${t.returnFuelEighths} between 0 and 8 and ${t.returnedAt} >= ${t.checkedOutAt})`,
    ),
    check(
      "rental_agreements_charges_check",
      sql`coalesce(${t.lateMinutes}, 0) >= 0 and coalesce(${t.lateFeeFils}, 0) >= 0 and coalesce(${t.fuelChargeFils}, 0) >= 0
        and coalesce(${t.damageChargeFils}, 0) >= 0 and coalesce(${t.returnVatFils}, 0) >= 0
        and coalesce(${t.returnChargesFils}, 0) >= 0 and coalesce(${t.outstandingFils}, 0) >= 0`,
    ),
  ],
);

export const damageReports = pgTable(
  "damage_reports",
  {
    id: id(),
    vehicleId: uuid("vehicle_id")
      .notNull()
      .references(() => vehicles.id, { onDelete: "restrict" }),
    reservationId: uuid("reservation_id").references(() => reservations.id, { onDelete: "set null" }),
    rentalAgreementId: uuid("rental_agreement_id").references(() => rentalAgreements.id, { onDelete: "set null" }),
    reportedBy: uuid("reported_by").references(() => users.id, { onDelete: "set null" }),
    stage: damageStage("stage").notNull(),
    severity: damageSeverity("severity").notNull(),
    status: damageStatus("status").notNull().default("OPEN"),
    location: text("location"),
    description: text("description").notNull(),
    /** Private storage keys of damage photos. */
    photoKeys: text("photo_keys").array().notNull().default(sql`'{}'::text[]`),
    estimatedCostFils: integer("estimated_cost_fils"),
    /** Amount charged to the renter (before VAT) for this damage. */
    chargeFils: integer("charge_fils").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("damage_reports_vehicle_idx").on(t.vehicleId, t.createdAt),
    index("damage_reports_reservation_idx").on(t.reservationId),
    index("damage_reports_agreement_idx").on(t.rentalAgreementId),
    index("damage_reports_reported_by_idx").on(t.reportedBy),
    check("damage_reports_description_check", sql`length(trim(${t.description})) > 0`),
    check(
      "damage_reports_money_check",
      sql`coalesce(${t.estimatedCostFils}, 0) >= 0 and ${t.chargeFils} >= 0`,
    ),
  ],
);

export const maintenanceBlocks = pgTable(
  "maintenance_blocks",
  {
    id: id(),
    vehicleId: uuid("vehicle_id")
      .notNull()
      .references(() => vehicles.id, { onDelete: "cascade" }),
    startsAt: tstz("starts_at").notNull(),
    endsAt: tstz("ends_at").notNull(),
    period: tstzrange("period")
      .notNull()
      .generatedAlwaysAs(sql`tstzrange(starts_at, ends_at, '[)')`),
    reason: text("reason").notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("maintenance_blocks_vehicle_idx").on(t.vehicleId, t.startsAt),
    index("maintenance_blocks_created_by_idx").on(t.createdBy),
    check("maintenance_blocks_period_check", sql`${t.endsAt} > ${t.startsAt}`),
  ],
);

/**
 * One row per thing that occupies a vehicle: an active reservation or a maintenance block.
 * Maintained only by database triggers (see drizzle/0002_occupancy_constraints.sql); never write to it
 * from application code. The exclusion constraint `vehicle_occupancy_no_overlap` guarantees that no
 * vehicle is ever double-booked across reservations and maintenance.
 */
export const vehicleOccupancy = pgTable(
  "vehicle_occupancy",
  {
    id: id(),
    vehicleId: uuid("vehicle_id")
      .notNull()
      .references(() => vehicles.id, { onDelete: "cascade" }),
    kind: occupancyKind("kind").notNull(),
    reservationId: uuid("reservation_id")
      .unique()
      .references(() => reservations.id, { onDelete: "cascade" }),
    maintenanceBlockId: uuid("maintenance_block_id")
      .unique()
      .references(() => maintenanceBlocks.id, { onDelete: "cascade" }),
    period: tstzrange("period").notNull(),
  },
  (t) => [
    index("vehicle_occupancy_vehicle_idx").on(t.vehicleId),
    check(
      "vehicle_occupancy_source_check",
      sql`(${t.kind} = 'RESERVATION' and ${t.reservationId} is not null and ${t.maintenanceBlockId} is null)
        or (${t.kind} = 'MAINTENANCE' and ${t.maintenanceBlockId} is not null and ${t.reservationId} is null)`,
    ),
    check("vehicle_occupancy_period_check", sql`not isempty(${t.period}) and lower_inc(${t.period}) and not upper_inc(${t.period})`),
  ],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: id(),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    data: jsonb("data").notNull().default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
  },
  (t) => [
    index("audit_logs_entity_idx").on(t.entityType, t.entityId),
    index("audit_logs_created_idx").on(t.createdAt),
    index("audit_logs_actor_idx").on(t.actorUserId),
  ],
);
