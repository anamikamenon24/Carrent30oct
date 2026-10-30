import { existsSync, readdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client, Pool } from "pg";
import { assertSafeTestUrl } from "../setup/load-env";

export const MIGRATIONS_FOLDER = "./drizzle";

export function hasMigrations() {
  return existsSync(`${MIGRATIONS_FOLDER}/meta/_journal.json`) &&
    readdirSync(MIGRATIONS_FOLDER).some((f) => f.endsWith(".sql"));
}

/** Drops everything in a *_test / driveeasy_qa_* database and applies all migrations. */
export async function resetAndMigrate(url: string) {
  assertSafeTestUrl(url);
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("drop schema if exists drizzle cascade");
    await client.query("drop schema if exists public cascade");
    await client.query("create schema public");
  } finally {
    await client.end();
  }
  await applyMigrations(url);
}

export async function applyMigrations(url: string) {
  if (!hasMigrations()) return;
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await pool.end();
  }
}

/** Creates an empty throwaway database on the local server (never touches dev/test data). */
export async function createScratchDb() {
  const base = new URL(process.env.TEST_DATABASE_URL!);
  const name = `driveeasy_qa_${Date.now()}_${randomBytes(3).toString("hex")}`;
  const admin = new Client({ connectionString: base.toString() });
  await admin.connect();
  try {
    await admin.query(`create database "${name}"`);
  } finally {
    await admin.end();
  }
  const url = new URL(base);
  url.pathname = `/${name}`;
  return {
    name,
    url: url.toString(),
    async drop() {
      const c = new Client({ connectionString: base.toString() });
      await c.connect();
      try {
        await c.query(`drop database if exists "${name}" with (force)`);
      } finally {
        await c.end();
      }
    },
  };
}

/** A pool on the test database for direct SQL in tests. */
export function testPool() {
  return new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 10 });
}

/** Empties every app table (keeps the schema and the drizzle migrations table). */
export async function truncateAll(pool: Pool) {
  const { rows } = await pool.query<{ t: string }>(
    `select quote_ident(tablename) as t from pg_tables where schemaname = 'public'`,
  );
  if (rows.length) await pool.query(`truncate ${rows.map((r) => r.t).join(", ")} restart identity cascade`);
}
