import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { damageReports } from "@/server/db/schema";
import { fileResponse, notFoundResponse } from "@/server/files";
import { getCurrentUser } from "@/server/session";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Damage photos are admin-only.
export async function GET(_req: Request, ctx: RouteContext<"/api/files/damage/[reportId]/[index]">) {
  const { reportId, index } = await ctx.params;
  const user = await getCurrentUser();
  const i = Number(index);
  if (user?.role !== "ADMIN" || !UUID_RE.test(reportId) || !Number.isInteger(i) || i < 0) return notFoundResponse();
  const [report] = await db
    .select({ keys: damageReports.photoKeys })
    .from(damageReports)
    .where(eq(damageReports.id, reportId))
    .limit(1);
  const key = report?.keys[i];
  if (!key) return notFoundResponse();
  return fileResponse(key);
}
