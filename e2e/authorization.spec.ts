import { expect, test } from "@playwright/test";
import {
  BRANCH_A,
  fillDriverDetails,
  localDateTime,
  logout,
  newUser,
  pay,
  register,
  startBooking,
} from "./helpers";

// Brief: users cannot access another user's reservations, vouchers or licence uploads;
// licence uploads are private and served only to the owner and admins;
// admin permissions for fleet, pricing, check-in and damage reports.

test.describe.serial("cross-user access", () => {
  const owner = newUser("owner");
  let reservationId = "";
  let licenceUrl = "";

  test("owner books a car and can see their own voucher and licence", async ({ page }) => {
    await register(page, owner);
    ({ reservationId } = await startBooking(page, {
      pickup: BRANCH_A, start: localDateTime(90, 10), end: localDateTime(91, 10),
    }));
    await fillDriverDetails(page);
    await pay(page, "pm_fake_success");
    await expect(page.getByTestId("voucher-reference")).toBeVisible();

    await page.goto("/profile");
    const link = page.getByTestId("licence-link");
    await expect(link).toBeAttached();
    licenceUrl = (await link.getAttribute("href")) ?? (await link.getAttribute("src")) ?? "";
    const res = await page.request.get(licenceUrl);
    expect(res.status()).toBe(200);
    expect(res.headers()["cache-control"] ?? "").toMatch(/private|no-store/);
  });

  test("another user gets 404 for the reservation, voucher and licence", async ({ page }) => {
    await register(page, newUser("intruder"));
    for (const path of [`/rentals/${reservationId}`, `/rentals/${reservationId}/voucher`]) {
      const res = await page.goto(path);
      expect(res?.status(), path).toBe(404);
    }
    expect((await page.request.get(licenceUrl)).status()).toBe(404);
    await page.goto("/rentals");
    await expect(page.getByTestId("rental-row")).toHaveCount(0);
  });

  test("anonymous visitors cannot fetch the licence or voucher", async ({ page }) => {
    expect((await page.request.get(licenceUrl)).status()).toBeGreaterThanOrEqual(401);
    const res = await page.goto(`/rentals/${reservationId}/voucher`);
    expect(page.url().includes("/login") || res?.status() === 404).toBe(true);
  });

  test("uploads are not reachable as static files", async ({ page }) => {
    for (const p of ["/storage/uploads/", "/uploads/", "/storage/e2e-uploads/"]) {
      const res = await page.request.get(p);
      expect(res.status(), p).toBe(404);
    }
  });
});

test.describe("admin permissions", () => {
  const adminPages = [
    "/admin",
    "/admin/branches",
    "/admin/fleet",
    "/admin/pricing",
    "/admin/reservations",
    "/admin/damage",
  ];

  test("a regular customer cannot open any admin page", async ({ page }) => {
    await register(page, newUser("cust"));
    for (const path of adminPages) {
      const res = await page.goto(path);
      expect(res?.status(), path).toBe(404);
    }
    await logout(page);
  });

  test("a regular customer cannot read damage images", async ({ page }) => {
    await register(page, newUser("cust2"));
    const res = await page.request.get("/api/files/damage/00000000-0000-0000-0000-000000000000/0");
    expect([403, 404]).toContain(res.status());
  });
});
