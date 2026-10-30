import "server-only";
import { sql } from "drizzle-orm";
import { headers } from "next/headers";
import { db } from "@/server/db";

/**
 * Fixed-window counters stored in Postgres (`rate_limits`), so limits hold across serverless instances.
 * Used by the login/sign-up server actions, which call Better Auth's API directly and therefore
 * bypass its HTTP rate limiter.
 */
export interface LimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

/** Client IP from proxy headers (Vercel sets x-forwarded-for; locally it may be absent). */
export async function clientIp(): Promise<string> {
  const h = await headers();
  return (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "local").trim() || "local";
}

/** Returns whether `key` is currently over `max` hits in `windowSeconds`, without counting a hit. */
export async function checkLimit(key: string, max: number, windowSeconds: number): Promise<LimitResult> {
  const now = Date.now();
  const { rows } = await db.execute<{ count: number; last_request: string }>(
    sql`select count, last_request from rate_limits where key = ${key} limit 1`,
  );
  const row = rows[0];
  if (!row) return { allowed: true, retryAfterSeconds: 0 };
  const windowEnds = Number(row.last_request) + windowSeconds * 1000;
  if (windowEnds <= now || row.count < max) return { allowed: true, retryAfterSeconds: 0 };
  return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((windowEnds - now) / 1000)) };
}

/** Counts one hit against `key`. A new window starts when the previous one has passed. */
export async function hitLimit(key: string, windowSeconds: number): Promise<void> {
  const now = Date.now();
  await db.execute(sql`
    insert into rate_limits (key, count, last_request) values (${key}, 1, ${now})
    on conflict (key) do update set
      count = case when rate_limits.last_request + ${windowSeconds * 1000} <= ${now} then 1 else rate_limits.count + 1 end,
      last_request = case when rate_limits.last_request + ${windowSeconds * 1000} <= ${now} then ${now} else rate_limits.last_request end`);
}

export async function clearLimit(key: string): Promise<void> {
  await db.execute(sql`delete from rate_limits where key = ${key}`);
}
