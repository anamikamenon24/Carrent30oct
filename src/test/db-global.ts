import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";
import { engineTestUrl } from "./db-target";

/** Recreates driveeasy_engine_test from scratch and applies every migration (a clean-database check). */
export default async function setup() {
  const { url, adminUrl } = engineTestUrl();
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query("drop database if exists driveeasy_engine_test with (force)");
    await admin.query("create database driveeasy_engine_test");
  } finally {
    await admin.end();
  }
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
  } finally {
    await client.end();
  }
}
