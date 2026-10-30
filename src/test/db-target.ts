import { config } from "dotenv";

/** The engine tests' own database: TEST_DATABASE_URL with the database renamed to driveeasy_engine_test. */
export function engineTestUrl() {
  config({ path: ".env.local", quiet: true });
  const base = process.env.TEST_DATABASE_URL;
  if (!base) throw new Error("TEST_DATABASE_URL is not set in .env.local");
  const url = new URL(base);
  if (!["localhost", "127.0.0.1"].includes(url.hostname)) throw new Error("Engine tests only run against a local database");
  url.pathname = "/driveeasy_engine_test";
  return { url: url.toString(), adminUrl: base };
}
