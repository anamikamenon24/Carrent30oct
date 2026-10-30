/**
 * Reservation reads for checkout, voucher, "my rentals" and admin screens.
 * Every customer-facing read takes the caller's userId and returns null for other users' reservations.
 */
import { aliasedTable, and, asc, desc, eq, gte, ilike, inArray, lt, or, sql, type SQL } from "drizzle-orm";
import { db, type DbOrTx } from "@/server/db";
import {
  branches,
  damageReports,
  deposits,
  driverProfiles,
  extras,
  payments,
  rentalAgreements,
  reservationExtras,
  reservations,
  users,
  vehicleCategories,
  vehicles,
} from "@/server/db/schema";
import { getVehicleSummaries, isUuid, type Branch, type VehicleSummary } from "@/server/data/catalog";
import { canModify, cancellationTerms, type CancellationTerms } from "./policy";
import type { ReservationRow } from "./holds";

export type ReservationStatus = ReservationRow["status"];

export interface ReservationListItem {
  reservation: ReservationRow;
  vehicle: { id: string; make: string; model: string; year: number; plateNumber: string; photos: string[]; categoryName: string };
  pickupBranch: Pick<Branch, "id" | "code" | "name" | "city" | "timeZone">;
  returnBranch: Pick<Branch, "id" | "code" | "name" | "city" | "timeZone">;
  customer: { id: string; name: string; email: string };
}

export interface ReservationDetail extends Omit<ReservationListItem, "vehicle" | "pickupBranch" | "returnBranch"> {
  vehicle: VehicleSummary;
  pickupBranch: Branch;
  returnBranch: Branch;
  extras: {
    extraId: string;
    code: string;
    name: string;
    pricing: "PER_DAY" | "PER_RENTAL";
    quantity: number;
    unitPriceFils: number;
    totalFils: number;
  }[];
  payments: (typeof payments.$inferSelect)[];
  deposits: (typeof deposits.$inferSelect)[];
  agreement: typeof rentalAgreements.$inferSelect | null;
  damageReports: (typeof damageReports.$inferSelect)[];
  driverProfile: Pick<typeof driverProfiles.$inferSelect, "id" | "firstName" | "lastName" | "licenceNumber" | "licenceExpiresOn" | "licenceVerifiedAt"> | null;
  /** What cancelling now would cost, per the cancellation policy. */
  cancellation: CancellationTerms;
  modification: { allowed: boolean; reason?: string };
}

const pickupB = aliasedTable(branches, "pickup_branch");
const returnB = aliasedTable(branches, "return_branch");
const branchCols = (b: typeof pickupB) => ({ id: b.id, code: b.code, name: b.name, city: b.city, timeZone: b.timeZone });

async function listWhere(where: SQL | undefined, order: SQL[], limit: number, conn: DbOrTx): Promise<ReservationListItem[]> {
  return conn
    .select({
      reservation: reservations,
      vehicle: {
        id: vehicles.id,
        make: vehicles.make,
        model: vehicles.model,
        year: vehicles.year,
        plateNumber: vehicles.plateNumber,
        photos: vehicles.photos,
        categoryName: vehicleCategories.name,
      },
      pickupBranch: branchCols(pickupB),
      returnBranch: branchCols(returnB),
      customer: { id: users.id, name: users.name, email: users.email },
    })
    .from(reservations)
    .innerJoin(vehicles, eq(vehicles.id, reservations.vehicleId))
    .innerJoin(vehicleCategories, eq(vehicleCategories.id, vehicles.categoryId))
    .innerJoin(pickupB, eq(pickupB.id, reservations.pickupBranchId))
    .innerJoin(returnB, eq(returnB.id, reservations.returnBranchId))
    .innerJoin(users, eq(users.id, reservations.userId))
    .where(where)
    .orderBy(...order)
    .limit(limit);
}

/** The user's reservations, newest pick-up first. */
export async function listUserReservations(
  userId: string,
  opts: { status?: ReservationStatus[] } = {},
  conn: DbOrTx = db,
): Promise<ReservationListItem[]> {
  if (!isUuid(userId)) return [];
  return listWhere(
    and(eq(reservations.userId, userId), opts.status?.length ? inArray(reservations.status, opts.status) : undefined),
    [desc(reservations.pickupAt)],
    500,
    conn,
  );
}

export interface AdminReservationFilter {
  status?: ReservationStatus[];
  /** Pick-up OR return branch. */
  branchId?: string;
  vehicleId?: string;
  /** Matches reference, customer name/email or plate number. */
  q?: string;
  /** Reservations overlapping [from, to). */
  from?: Date;
  to?: Date;
  limit?: number;
}

/** Admin list. Caller must check the admin role. */
export async function listReservations(f: AdminReservationFilter = {}, conn: DbOrTx = db): Promise<ReservationListItem[]> {
  const q = f.q?.trim();
  const like = q ? `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
  return listWhere(
    and(
      f.status?.length ? inArray(reservations.status, f.status) : undefined,
      f.branchId && isUuid(f.branchId)
        ? or(eq(reservations.pickupBranchId, f.branchId), eq(reservations.returnBranchId, f.branchId))
        : undefined,
      f.vehicleId && isUuid(f.vehicleId) ? eq(reservations.vehicleId, f.vehicleId) : undefined,
      like
        ? or(
            ilike(reservations.reference, like),
            ilike(users.name, like),
            ilike(users.email, like),
            ilike(vehicles.plateNumber, like),
          )
        : undefined,
      f.to ? lt(reservations.pickupAt, f.to) : undefined,
      f.from ? gte(reservations.returnAt, f.from) : undefined,
    ),
    [asc(reservations.pickupAt)],
    Math.min(f.limit ?? 200, 1000),
    conn,
  );
}

/**
 * Full reservation for checkout, voucher, detail and admin pages.
 * Pass `userId` for customer pages: returns null when that user does not own it. Omit only for admins.
 */
export async function getReservationDetail(
  idOrReference: string,
  opts: { userId?: string; now?: Date } = {},
  conn: DbOrTx = db,
): Promise<ReservationDetail | null> {
  const where = isUuid(idOrReference)
    ? eq(reservations.id, idOrReference)
    : eq(reservations.reference, idOrReference.trim().toUpperCase());
  const [row] = await conn
    .select({ reservation: reservations, pickupBranch: pickupB, returnBranch: returnB, customer: { id: users.id, name: users.name, email: users.email } })
    .from(reservations)
    .innerJoin(pickupB, eq(pickupB.id, reservations.pickupBranchId))
    .innerJoin(returnB, eq(returnB.id, reservations.returnBranchId))
    .innerJoin(users, eq(users.id, reservations.userId))
    .where(where)
    .limit(1);
  if (!row) return null;
  const r = row.reservation;
  if (opts.userId !== undefined && r.userId !== opts.userId) return null;

  const [vehicle] = await getVehicleSummaries([r.vehicleId], conn);
  const [extraLines, pays, deps, [agreement], damage, [driver]] = await Promise.all([
    conn
      .select({
        extraId: reservationExtras.extraId,
        code: extras.code,
        name: extras.name,
        pricing: reservationExtras.pricing,
        quantity: reservationExtras.quantity,
        unitPriceFils: reservationExtras.unitPriceFils,
        totalFils: reservationExtras.totalFils,
      })
      .from(reservationExtras)
      .innerJoin(extras, eq(extras.id, reservationExtras.extraId))
      .where(eq(reservationExtras.reservationId, r.id))
      .orderBy(asc(extras.sortOrder)),
    conn.select().from(payments).where(eq(payments.reservationId, r.id)).orderBy(asc(payments.createdAt)),
    conn.select().from(deposits).where(eq(deposits.reservationId, r.id)).orderBy(asc(deposits.createdAt)),
    conn.select().from(rentalAgreements).where(eq(rentalAgreements.reservationId, r.id)),
    conn.select().from(damageReports).where(eq(damageReports.reservationId, r.id)).orderBy(asc(damageReports.createdAt)),
    r.driverProfileId
      ? conn
          .select({
            id: driverProfiles.id,
            firstName: driverProfiles.firstName,
            lastName: driverProfiles.lastName,
            licenceNumber: driverProfiles.licenceNumber,
            licenceExpiresOn: driverProfiles.licenceExpiresOn,
            licenceVerifiedAt: driverProfiles.licenceVerifiedAt,
          })
          .from(driverProfiles)
          .where(eq(driverProfiles.id, r.driverProfileId))
      : Promise.resolve([]),
  ]);
  const now = opts.now ?? new Date();
  return {
    reservation: r,
    vehicle,
    pickupBranch: row.pickupBranch,
    returnBranch: row.returnBranch,
    customer: row.customer,
    extras: extraLines,
    payments: pays,
    deposits: deps,
    agreement: agreement ?? null,
    damageReports: damage,
    driverProfile: driver ?? null,
    cancellation: cancellationTerms(r, now),
    modification: canModify(r, now),
  };
}

/** Counts for the admin dashboard. */
export async function reservationStats(now = new Date(), conn: DbOrTx = db) {
  const iso = now.toISOString();
  const { rows } = await conn.execute<{
    pending: number;
    confirmed: number;
    on_rent: number;
    pickups_today: number;
    returns_today: number;
    overdue: number;
  }>(sql`select
      count(*) filter (where status = 'PENDING')::int as pending,
      count(*) filter (where status = 'CONFIRMED')::int as confirmed,
      count(*) filter (where status = 'PICKED_UP')::int as on_rent,
      count(*) filter (where status = 'CONFIRMED' and pickup_at >= ${iso}::timestamptz and pickup_at < ${iso}::timestamptz + interval '24 hours')::int as pickups_today,
      count(*) filter (where status = 'PICKED_UP' and return_at >= ${iso}::timestamptz and return_at < ${iso}::timestamptz + interval '24 hours')::int as returns_today,
      count(*) filter (where status = 'PICKED_UP' and return_at < ${iso}::timestamptz)::int as overdue
    from reservations`);
  const r = rows[0];
  return {
    pending: r.pending,
    confirmed: r.confirmed,
    onRent: r.on_rent,
    pickupsNext24h: r.pickups_today,
    returnsNext24h: r.returns_today,
    overdue: r.overdue,
  };
}
