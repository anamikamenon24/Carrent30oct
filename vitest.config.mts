import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: { tsconfigPaths: true },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          include: ["src/**/*.test.{ts,tsx}"],
          exclude: ["src/**/*.db.test.ts"],
        },
      },
      {
        // Database-engine integration tests: run against a throwaway local database
        // (driveeasy_engine_test) that globalSetup recreates and migrates on every run.
        extends: true,
        test: {
          name: "db",
          environment: "node",
          include: ["src/**/*.db.test.ts"],
          setupFiles: ["src/test/db-env.ts"],
          globalSetup: ["src/test/db-global.ts"],
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
      {
        // QA integration tests: run against the local driveeasy_test database (port 5433).
        extends: true,
        test: {
          name: "qa",
          environment: "node",
          include: ["tests/qa/**/*.qa.test.ts"],
          setupFiles: ["tests/qa/setup/env.ts"],
          globalSetup: ["tests/qa/setup/global.ts"],
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
