import { Pool as NeonPool } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless";
import { drizzle as drizzlePg, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { getEnv } from "@/server/config";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;
/** A transaction handle; has the same query API as `db`. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
/** Either the shared database handle or an open transaction. */
export type DbOrTx = Db | Tx;

const store = globalThis as unknown as { __db?: Db; __dbPool?: { end(): Promise<void> } };

function createDb(): Db {
  const env = getEnv();
  if (env.DATABASE_DRIVER === "neon") {
    // Neon serverless driver over WebSockets (Node 22+ has a global WebSocket). Supports interactive
    // transactions and SELECT ... FOR UPDATE, which the reservation transaction needs.
    const pool = new NeonPool({ connectionString: env.DATABASE_URL, max: env.DATABASE_POOL_MAX });
    store.__dbPool = pool;
    // The neon-serverless and node-postgres Drizzle databases expose the same query API.
    return drizzleNeon(pool, { schema }) as unknown as Db;
  }
  const pool = new Pool({ connectionString: env.DATABASE_URL, max: env.DATABASE_POOL_MAX });
  store.__dbPool = pool;
  return drizzlePg(pool, { schema });
}

// One pool per process (reused across Next.js hot reloads).
export const db: Db = (store.__db ??= createDb());

/** Closes the pool (scripts and tests). */
export async function closeDb() {
  await store.__dbPool?.end();
  store.__db = undefined;
  store.__dbPool = undefined;
}

export { schema };
