import { loadTestEnv } from "./load-env";
import { resetAndMigrate } from "../helpers/db";

/** Rebuilds driveeasy_test from the migrations once per `pnpm test` run. */
export default async function setup() {
  const url = loadTestEnv();
  await resetAndMigrate(url);
}
