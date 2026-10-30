import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { getEnv } from "@/server/config";
import { isJobName, runJob } from "@/server/jobs";

// Entry point for a cloud scheduler (SCHEDULER_PROVIDER=cloud-cron). Locally, use `pnpm jobs:*`.
export async function GET(req: NextRequest, ctx: RouteContext<"/api/cron/[job]">) {
  const expected = Buffer.from(`Bearer ${getEnv().CRON_SECRET}`);
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return new Response("Unauthorized", { status: 401 });
  }
  const { job } = await ctx.params;
  if (!isJobName(job)) return new Response("Unknown job", { status: 404 });
  return Response.json(await runJob(job));
}
