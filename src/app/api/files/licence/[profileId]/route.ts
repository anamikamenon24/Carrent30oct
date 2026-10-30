import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { driverProfiles } from "@/server/db/schema";
import { fileResponse, notFoundResponse } from "@/server/files";
import { getCurrentUser } from "@/server/session";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Licence images are private: only the owner and admins may see them. Everyone else gets a 404.
export async function GET(_req: Request, ctx: RouteContext<"/api/files/licence/[profileId]">) {
  const { profileId } = await ctx.params;
  const user = await getCurrentUser();
  if (!user || !UUID_RE.test(profileId)) return notFoundResponse();
  const [profile] = await db
    .select({ userId: driverProfiles.userId, key: driverProfiles.licenceFileKey })
    .from(driverProfiles)
    .where(eq(driverProfiles.id, profileId))
    .limit(1);
  if (!profile?.key || (profile.userId !== user.id && user.role !== "ADMIN")) return notFoundResponse();
  return fileResponse(profile.key);
}
