import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, type DbOrTx } from "@/server/db";
import { driverProfiles } from "@/server/db/schema";
import { audit } from "@/server/audit";
import { ReservationError } from "@/server/reservations/errors";

export type DriverProfile = typeof driverProfiles.$inferSelect;

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const optional = z
  .string()
  .trim()
  .max(200)
  .optional()
  .nullable()
  .transform((v) => (v ? v : null));

export const driverProfileInput = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  dateOfBirth: dateStr,
  phone: z.string().trim().min(5).max(30),
  nationality: optional,
  addressLine: optional,
  city: optional,
  country: optional,
  licenceNumber: z.string().trim().min(3).max(50),
  licenceCountry: z.string().trim().min(2).max(100),
  licenceIssuedOn: dateStr.optional().nullable(),
  licenceExpiresOn: dateStr,
  /** Private storage key returned by storeUpload(). Omit to keep the current file. */
  licenceFileKey: z.string().min(1).max(500).optional().nullable(),
});
export type DriverProfileInput = z.input<typeof driverProfileInput>;

export async function getDriverProfile(userId: string, conn: DbOrTx = db): Promise<DriverProfile | null> {
  const [p] = await conn.select().from(driverProfiles).where(eq(driverProfiles.userId, userId)).limit(1);
  return p ?? null;
}

/** By profile id; returns null unless `viewer` owns it or is an admin. Use before serving the licence file. */
export async function getDriverProfileForViewer(
  profileId: string,
  viewer: { id: string; role: "CUSTOMER" | "ADMIN" },
): Promise<DriverProfile | null> {
  if (!z.uuid().safeParse(profileId).success) return null;
  const [p] = await db.select().from(driverProfiles).where(eq(driverProfiles.id, profileId)).limit(1);
  if (!p || (viewer.role !== "ADMIN" && p.userId !== viewer.id)) return null;
  return p;
}

/**
 * Creates or updates the user's driver profile. Changing the licence number or file clears the
 * verification stamp. Throws ReservationError("VALIDATION") with field messages on bad input.
 */
export async function upsertDriverProfile(userId: string, input: DriverProfileInput): Promise<DriverProfile> {
  const parsed = driverProfileInput.safeParse(input);
  if (!parsed.success) {
    throw new ReservationError("VALIDATION", "Please check your driver details", {
      fields: z.flattenError(parsed.error).fieldErrors,
    });
  }
  const v = parsed.data;
  const today = new Date().toISOString().slice(0, 10);
  if (v.dateOfBirth >= today) throw new ReservationError("VALIDATION", "Enter a valid date of birth");
  if (v.licenceIssuedOn && v.licenceIssuedOn >= v.licenceExpiresOn) {
    throw new ReservationError("VALIDATION", "The licence expiry must be after its issue date");
  }
  return db.transaction(async (tx) => {
    const existing = await getDriverProfile(userId, tx);
    const values = {
      firstName: v.firstName,
      lastName: v.lastName,
      dateOfBirth: v.dateOfBirth,
      phone: v.phone,
      nationality: v.nationality,
      addressLine: v.addressLine,
      city: v.city,
      country: v.country,
      licenceNumber: v.licenceNumber,
      licenceCountry: v.licenceCountry,
      licenceIssuedOn: v.licenceIssuedOn ?? null,
      licenceExpiresOn: v.licenceExpiresOn,
      ...(v.licenceFileKey ? { licenceFileKey: v.licenceFileKey } : {}),
    };
    let row: DriverProfile;
    if (existing) {
      const reverify =
        existing.licenceNumber !== v.licenceNumber || (v.licenceFileKey && v.licenceFileKey !== existing.licenceFileKey);
      [row] = await tx
        .update(driverProfiles)
        .set({ ...values, ...(reverify ? { licenceVerifiedAt: null } : {}) })
        .where(eq(driverProfiles.id, existing.id))
        .returning();
    } else {
      [row] = await tx.insert(driverProfiles).values({ userId, ...values }).returning();
    }
    await audit(tx, {
      actorUserId: userId,
      action: existing ? "driver_profile.updated" : "driver_profile.created",
      entityType: "driver_profile",
      entityId: row.id,
    });
    return row;
  });
}

/** Admin: marks the licence as checked. */
export async function verifyDriverLicence(profileId: string, adminId: string) {
  const [row] = await db
    .update(driverProfiles)
    .set({ licenceVerifiedAt: new Date() })
    .where(eq(driverProfiles.id, profileId))
    .returning();
  if (!row) throw new ReservationError("NOT_FOUND", "Driver profile not found");
  await audit(db, { actorUserId: adminId, action: "driver_profile.verified", entityType: "driver_profile", entityId: row.id });
  return row;
}
