import { defineConfig, devices } from "@playwright/test";
import { loadTestEnv } from "./tests/qa/setup/load-env";

// E2E runs a production build (`next build && next start`) on its own port against the
// local driveeasy_test database, so it never touches driveeasy_dev and does not collide with
// a `next dev` server (Next 16 allows only one dev server per project).
// Set E2E_SKIP_BUILD=1 to reuse the last build.
const testDbUrl = loadTestEnv();
const port = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://localhost:${port}`;

const serverEnv: Record<string, string> = {
  DATABASE_URL: testDbUrl,
  BETTER_AUTH_URL: baseURL,
  NEXT_PUBLIC_APP_URL: baseURL,
  FAKE_PAYMENTS_WEBHOOK_URL: `${baseURL}/api/webhooks/payments`,
  PAYMENTS_PROVIDER: "fake",
  STORAGE_PROVIDER: "local",
  UPLOADS_DIR: "./storage/e2e-uploads",
};

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  // Tests share one database; flows that depend on availability must not race each other.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  timeout: 60_000,
  reporter: [["list"], ["html", { open: "never" }]],
  use: { baseURL, trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    // Full functional suite on desktop Chromium.
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    // Smoke + layout checks on the other engines and on phones.
    { name: "firefox", use: { ...devices["Desktop Firefox"] }, grep: /@layout|@smoke/ },
    { name: "webkit", use: { ...devices["Desktop Safari"] }, grep: /@layout|@smoke/ },
    { name: "mobile-chrome", use: { ...devices["Pixel 7"] }, grep: /@layout|@smoke|@mobile/ },
    { name: "mobile-safari", use: { ...devices["iPhone 14"] }, grep: /@layout|@smoke|@mobile/ },
  ],
  webServer: {
    command: process.env.E2E_SKIP_BUILD
      ? `pnpm exec next start -p ${port}`
      : `pnpm exec next build && pnpm exec next start -p ${port}`,
    url: baseURL,
    env: serverEnv,
    timeout: 600_000,
    reuseExistingServer: false,
    stdout: "pipe",
  },
});
