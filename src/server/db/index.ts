import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { getEnv } from "@/server/config";
import * as schema from "./schema";

const store = globalThis as unknown as { __pgPool?: Pool };

// One pool per process (reused across Next.js hot reloads).
const pool = (store.__pgPool ??= new Pool({ connectionString: getEnv().DATABASE_URL }));

export const db = drizzle(pool, { schema });
