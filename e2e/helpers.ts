import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { expect, type Page } from "@playwright/test";

export const PASSWORD = "Qa-Passw0rd!2026";

export interface TestUser {
  name: string;
  email: string;
  password: string;
}

export function newUser(prefix = "qa"): TestUser {
  const id = randomBytes(4).toString("hex");
  return { name: `QA ${prefix} ${id}`, email: `${prefix}-${id}@example.test`, password: PASSWORD };
}

/** Registers through the UI. Leaves the user signed in. */
export async function register(page: Page, user: TestUser) {
  await page.goto("/register");
  await page.getByLabel(/full name/i).fill(user.name);
  await page.getByLabel(/email/i).fill(user.email);
  await page.getByLabel(/^password/i).first().fill(user.password);
  const confirm = page.getByLabel(/confirm password/i);
  if (await confirm.count()) await confirm.fill(user.password);
  await page.getByRole("button", { name: /register|sign up|create account/i }).click();
  await expect(page).not.toHaveURL(/\/register/);
}

export async function login(page: Page, user: Pick<TestUser, "email" | "password">) {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(user.email);
  await page.getByLabel(/password/i).fill(user.password);
  await page.getByRole("button", { name: /log ?in|sign ?in/i }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

export async function logout(page: Page) {
  // Phones: hamburger (nav-menu-button); desktop: account menu (user-menu). Both contain sign-out.
  const mobile = page.getByTestId("nav-menu-button");
  if (await mobile.isVisible().catch(() => false)) await mobile.click();
  else await page.getByTestId("user-menu").click();
  await page.getByTestId("sign-out").click();
  await expect(page.getByTestId("sign-out")).toHaveCount(0);
}

/** Registers a user through the UI and promotes it with `pnpm admin:create` on the test DB. */
export async function createAdmin(page: Page) {
  const admin = newUser("admin");
  await register(page, admin);
  await logout(page);
  execSync(`pnpm admin:create ${admin.email}`, {
    stdio: "pipe",
    env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL },
  });
  await login(page, admin);
  return admin;
}

/** YYYY-MM-DDTHH:mm, `daysAhead` days from today at `hour`:00 (branch local time). */
export function localDateTime(daysAhead: number, hour = 10, minute = 0) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysAhead);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(hour)}:${pad(minute)}`;
}

export interface SearchParams {
  pickup: string;
  dropoff?: string;
  start: string;
  end: string;
  [key: string]: string | undefined;
}

export function searchQuery(p: SearchParams) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries({ dropoff: p.pickup, ...p })) if (v !== undefined) q.set(k, v);
  return q.toString();
}

/** Seeded branch codes; overridable while the seed is in flux. */
export const BRANCH_A = process.env.E2E_BRANCH_A ?? "DXB-APT";
export const BRANCH_B = process.env.E2E_BRANCH_B ?? "AUH-APT";

export async function fils(page: Page, testId: string) {
  const el = page.getByTestId(testId);
  await expect(el).toBeVisible();
  const v = await el.getAttribute("data-fils");
  expect(v, `${testId} must carry data-fils`).toMatch(/^-?\d+$/);
  return Number(v);
}

/** A tiny valid PNG, used as a driving-licence photo. */
export const LICENCE_PNG = {
  name: "licence.png",
  mimeType: "image/png",
  buffer: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
};

/** Fills the driver-details form on checkout. */
export async function fillDriverDetails(page: Page) {
  const fillIf = async (label: RegExp, value: string) => {
    const f = page.getByLabel(label);
    if (await f.count()) await f.first().fill(value);
  };
  await fillIf(/^first name/i, "QA");
  await fillIf(/^last name/i, "Driver");
  await fillIf(/phone/i, "+971500000000");
  await fillIf(/date of birth/i, "1990-01-15");
  await fillIf(/licen[cs]e number/i, `DL-${randomBytes(3).toString("hex")}`);
  await fillIf(/licen[cs]e expiry/i, "2030-12-31");
  const country = page.getByLabel(/licen[cs]e country/i);
  if (await country.count()) {
    const tag = await country.first().evaluate((e) => e.tagName);
    if (tag === "SELECT") await country.first().selectOption("AE");
    else await country.first().fill("AE");
  }
  await page.getByTestId("licence-upload").setInputFiles(LICENCE_PNG);
}

/** Search → first result → book → extras → checkout. Returns the reservation id. */
export async function startBooking(
  page: Page,
  params: SearchParams,
  extras: string[] = [],
): Promise<{ reservationId: string; vehicleId: string }> {
  await page.goto(`/search?${searchQuery(params)}`);
  const card = page.getByTestId("vehicle-card").first();
  await expect(card).toBeVisible();
  await card.getByRole("link").first().click();
  await expect(page).toHaveURL(/\/vehicles\/[^/?]+/);
  const vehicleId = new URL(page.url()).pathname.split("/")[2];
  await page.getByRole("link", { name: /book|reserve|select/i }).first().click();
  await expect(page).toHaveURL(/\/book\//);
  // Date-selection step: dates are prefilled from the search params.
  if (!/\/extras/.test(page.url())) await page.getByRole("button", { name: /continue|next/i }).click();
  await expect(page).toHaveURL(/\/book\/[^/]+\/extras/);
  for (const code of extras) await page.getByTestId(`extra-${code}`).check();
  await page.getByTestId("continue-to-checkout").click();
  await expect(page).toHaveURL(/\/checkout\/[^/?]+/);
  return { reservationId: new URL(page.url()).pathname.split("/")[2], vehicleId };
}

export async function pay(page: Page, method: "pm_fake_success" | "pm_fake_fail" | "pm_fake_cancel") {
  await page.getByTestId("payment-method").selectOption(method);
  const terms = page.getByTestId("accept-terms");
  if (!(await terms.isChecked())) await terms.check();
  await page.getByTestId("pay-button").click();
}
