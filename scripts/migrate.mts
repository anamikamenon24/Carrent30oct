// Applies pending Drizzle migrations from ./drizzle. Safe to run repeatedly (applied ones are skipped).
//   Local:   pnpm db:migrate:deploy            (uses DATABASE_URL from .env.local)
//   Vercel:  runs in the build step (see vercel.json). Uses a direct, non-pooled connection:
//            MIGRATION_DATABASE_URL, else DATABASE_URL_UNPOOLED (set by the Neon integration), else DATABASE_URL.
// A Postgres advisory lock stops two concurrent deployments from migrating at the same time.
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";

if (process.env.SKIP_MIGRATIONS === "1") {
  console.log("[migrate] SKIP_MIGRATIONS=1, skipping.");
  process.exit(0);
}

const url = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) {
  console.error("[migrate] No database URL: set MIGRATION_DATABASE_URL, DATABASE_URL_UNPOOLED or DATABASE_URL.");
  process.exit(1);
}

const LOCK_ID = 7_243_911; // arbitrary, constant per app
const client = new Client({ connectionString: url });
await client.connect();
const target = new URL(url);
console.log(`[migrate] ${target.hostname}${target.pathname} (env: ${process.env.VERCEL_ENV ?? "local"})`);
try {
  await client.query("select pg_advisory_lock($1)", [LOCK_ID]);
  const started = Date.now();
  await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
  console.log(`[migrate] up to date in ${Date.now() - started} ms`);
} catch (err) {
  console.error("[migrate] failed:", err);
  process.exitCode = 1;
} finally {
  await client.query("select pg_advisory_unlock($1)", [LOCK_ID]).catch(() => {});
  await client.end();
}
