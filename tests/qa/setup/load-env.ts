import { config } from "dotenv";

/**
 * Loads .env.local and points the app at the test database. Refuses to run against
 * anything that is not a local *_test database, so driveeasy_dev can never be wiped.
 */
export function loadTestEnv() {
  config({ path: ".env.local", quiet: true });
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set in .env.local");
  assertSafeTestUrl(url);
  process.env.DATABASE_URL = url;
  (process.env as Record<string, string>).NODE_ENV = "test";
  return url;
}

export function assertSafeTestUrl(url: string) {
  const u = new URL(url);
  const db = u.pathname.slice(1);
  if (!["localhost", "127.0.0.1"].includes(u.hostname) || !/_test$|^driveeasy_qa_/.test(db)) {
    throw new Error(`Refusing to use ${u.hostname}/${db}: QA tests only run on local *_test or driveeasy_qa_* databases`);
  }
}
