import { expect, test, type Page } from "@playwright/test";
import {
  BRANCH_A,
  BRANCH_B,
  createAdmin,
  fillDriverDetails,
  fils,
  localDateTime,
  logout,
  newUser,
  pay,
  register,
  startBooking,
} from "./helpers";

// Brief: complete rentals from search through payment, pick-up voucher, check-out and return;
// price breakdown shown before payment; payment success/failure/cancel/retry; cancellation.

const VAT_RATE = 0.05;

/** Checks the breakdown adds up: VAT 5% on rental+extras+one-way fee, deposit not taxed. */
async function checkBreakdown(page: Page, expectedDays: number, oneWay: boolean) {
  const daily = await fils(page, "price-daily-rate");
  const days = Number(await page.getByTestId("price-days").getAttribute("data-value") ??
    (await page.getByTestId("price-days").textContent())?.match(/\d+/)?.[0]);
  const rental = await fils(page, "price-rental");
  const extras = await fils(page, "price-extras-total");
  const oneWayFee = await fils(page, "price-one-way-fee");
  const vat = await fils(page, "price-vat");
  const deposit = await fils(page, "price-deposit");
  const total = await fils(page, "price-total");

  expect(days).toBe(expectedDays);
  expect(rental).toBe(daily * days);
  if (oneWay) expect(oneWayFee).toBeGreaterThan(0);
  else expect(oneWayFee).toBe(0);
  expect(vat).toBe(Math.round((rental + extras + oneWayFee) * VAT_RATE));
  expect(deposit).toBeGreaterThan(0);
  // The charge total excludes the refundable deposit (a separate hold).
  expect(total).toBe(rental + extras + oneWayFee + vat);
  return { daily, days, rental, extras, oneWayFee, vat, deposit, total };
}

test.describe.serial("complete rental", () => {
  let reservationId = "";
  let reference = "";
  const customer = newUser("renter");

  test("search → extras → price breakdown → pay → voucher", async ({ page }) => {
    await register(page, customer);
    ({ reservationId } = await startBooking(
      page,
      { pickup: BRANCH_A, dropoff: BRANCH_B, start: localDateTime(40, 10), end: localDateTime(43, 10) },
      ["CHILD_SEAT", "GPS"],
    ));

    const b = await checkBreakdown(page, 3, true);
    const extraLines = await page.locator('[data-testid^="price-extra-"]:not([data-testid="price-extras-total"])')
      .evaluateAll((els) => els.map((e) => Number(e.getAttribute("data-fils"))));
    expect(extraLines.length).toBe(2);
    expect(extraLines.reduce((a, x) => a + x, 0)).toBe(b.extras);

    await fillDriverDetails(page);
    await pay(page, "pm_fake_success");

    await expect(page).toHaveURL(new RegExp(`/rentals/${reservationId}/voucher`));
    reference = (await page.getByTestId("voucher-reference").textContent())?.trim() ?? "";
    expect(reference).toMatch(/^[A-Z0-9-]{6,}$/);
    const qr = page.getByTestId("voucher-qr");
    await expect(qr).toBeVisible();
    expect(await qr.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(50);
  });

  test("my rentals lists the confirmed reservation", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(customer.email);
    await page.getByLabel(/password/i).fill(customer.password);
    await page.getByRole("button", { name: /log ?in|sign ?in/i }).click();
    await page.goto("/rentals");
    const row = page.getByTestId("rental-row").filter({ hasText: reference });
    await expect(row).toBeVisible();
    await expect(row).toContainText(/confirmed/i);
  });

  test("admin checks the car out and back in, recording mileage, fuel and damage", async ({ page }) => {
    await createAdmin(page);
    await page.goto(`/admin/reservations/${reservationId}`);
    const out = page.getByTestId("checkout-form");
    await out.getByLabel(/mileage|odometer/i).fill("12000");
    await out.getByLabel("Fuel level").selectOption("8");
    await page.getByTestId("checkout-submit").click();
    await expect(page.getByText(/picked.?up/i).first()).toBeVisible();

    const back = page.getByTestId("checkin-form");
    // Mileage going backwards must be rejected.
    await back.getByLabel(/mileage|odometer/i).fill("11000");
    await page.getByTestId("checkin-submit").click();
    await expect(page.getByRole("alert")).toBeVisible();

    await back.getByLabel(/mileage|odometer/i).fill("12450");
    await back.getByLabel("Fuel level").selectOption("6");
    await page.getByTestId("checkin-submit").click();
    await expect(page.getByText(/returned/i).first()).toBeVisible();

    await page.goto("/admin/damage");
    const dmg = page.getByTestId("damage-form");
    await expect(dmg).toBeVisible();
  });
});

test.describe("payment outcomes", () => {
  test("declined card shows an error, then a retry succeeds without a duplicate booking", async ({ page }) => {
    await register(page, newUser("retry"));
    const { reservationId } = await startBooking(page, {
      pickup: BRANCH_A, start: localDateTime(50, 9), end: localDateTime(52, 9),
    });
    await fillDriverDetails(page);
    await pay(page, "pm_fake_fail");
    await expect(page.getByRole("alert")).toContainText(/declined|failed/i);
    await expect(page).toHaveURL(new RegExp(`/checkout/${reservationId}`));

    await pay(page, "pm_fake_success");
    await expect(page).toHaveURL(new RegExp(`/rentals/${reservationId}/voucher`));
    await page.goto("/rentals");
    await expect(page.getByTestId("rental-row")).toHaveCount(1);
  });

  test("abandoned payment leaves the reservation unconfirmed", async ({ page }) => {
    await register(page, newUser("abandon"));
    const { reservationId } = await startBooking(page, {
      pickup: BRANCH_A, start: localDateTime(55, 9), end: localDateTime(56, 9),
    });
    await fillDriverDetails(page);
    await pay(page, "pm_fake_cancel");
    await expect(page.getByRole("alert")).toBeVisible();
    const voucher = await page.goto(`/rentals/${reservationId}/voucher`);
    expect(voucher?.status()).toBe(404);
  });

  test("double-clicking pay charges once", async ({ page }) => {
    await register(page, newUser("dbl"));
    const { reservationId } = await startBooking(page, {
      pickup: BRANCH_A, start: localDateTime(60, 9), end: localDateTime(61, 9),
    });
    await fillDriverDetails(page);
    await page.getByTestId("payment-method").selectOption("pm_fake_success");
    await page.getByTestId("accept-terms").check();
    await page.getByTestId("pay-button").dblclick();
    await expect(page).toHaveURL(new RegExp(`/rentals/${reservationId}/voucher`));
    await page.goto(`/rentals/${reservationId}`);
    await expect(page.getByTestId("payment-row")).toHaveCount(1);
  });
});

test.describe("modify and cancel", () => {
  test("customer cancels an eligible reservation and is refunded", async ({ page }) => {
    await register(page, newUser("cancel"));
    const { reservationId } = await startBooking(page, {
      pickup: BRANCH_A, start: localDateTime(70, 9), end: localDateTime(72, 9),
    });
    await fillDriverDetails(page);
    await pay(page, "pm_fake_success");
    await page.goto(`/rentals/${reservationId}`);
    await page.getByTestId("cancel-reservation-button").click();
    await page.getByTestId("confirm-cancel").click();
    await expect(page.getByText(/cancelled|refunded/i).first()).toBeVisible();
    // The cancelled reservation's voucher is no longer valid.
    await page.goto(`/rentals/${reservationId}/voucher`);
    await expect(page.getByTestId("voucher-qr")).toHaveCount(0);
  });

  test("customer modifies dates and the price is recalculated", async ({ page }) => {
    await register(page, newUser("modify"));
    const { reservationId } = await startBooking(page, {
      pickup: BRANCH_A, start: localDateTime(80, 9), end: localDateTime(82, 9),
    });
    await fillDriverDetails(page);
    await pay(page, "pm_fake_success");
    await page.goto(`/rentals/${reservationId}`);
    await page.getByTestId("modify-dates-button").click();
    await page.getByLabel("Return date").fill(localDateTime(84, 9).slice(0, 10));
    await page.getByRole("button", { name: /save|update|confirm/i }).click();
    await expect(page.getByTestId("price-days")).toContainText("4");
  });

  test("the logged-out header has no stale session after logout", async ({ page }) => {
    await register(page, newUser("lo"));
    await logout(page);
    await page.goto("/rentals");
    await expect(page).toHaveURL(/\/login/);
  });
});
