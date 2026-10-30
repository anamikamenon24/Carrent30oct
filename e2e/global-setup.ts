import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { loadTestEnv } from "../tests/qa/setup/load-env";
import { resetAndMigrate } from "../tests/qa/helpers/db";

/**
 * Rebuilds driveeasy_test from the migrations and seeds it before the E2E run.
 * Runs after the web server has started; the app reads the DB per request, so that is fine.
 */
export default async function globalSetup() {
  const url = loadTestEnv();
  await resetAndMigrate(url);
  const scripts = JSON.parse(readFileSync("package.json", "utf8")).scripts ?? {};
  if (scripts["db:seed"]) {
    // db:seed loads .env.local itself; the explicit DATABASE_URL must win over it.
    execSync("pnpm db:seed", {
      stdio: "inherit",
      env: { ...process.env, DATABASE_URL: url },
    });
  }
}
