import { expect, test } from "@playwright/test";
import { BRANCH_A, BRANCH_B, localDateTime, searchQuery } from "./helpers";

// Brief: vehicle search, branch selection, date ranges, filters and availability calendars.

const base = { pickup: BRANCH_A, start: localDateTime(30, 10), end: localDateTime(33, 10) };

test.describe("search", () => {
  test("home search form leads to results for the chosen branch and dates @smoke", async ({ page }) => {
    await page.goto("/");
    const form = page.getByTestId("search-form");
    await form.getByLabel("Pick-up branch").selectOption({ value: BRANCH_A });
    await form.getByLabel("Return branch").selectOption({ value: BRANCH_B });
    await form.getByLabel("Pick-up date").fill(base.start.slice(0, 10));
    await form.getByLabel("Pick-up time").fill("10:00");
    await form.getByLabel("Return date").fill(base.end.slice(0, 10));
    await form.getByLabel("Return time").fill("10:00");
    await page.getByTestId("search-submit").click();

    await expect(page).toHaveURL(/\/search\?/);
    const url = new URL(page.url());
    expect(url.searchParams.get("pickup")).toBe(BRANCH_A);
    expect(url.searchParams.get("dropoff")).toBe(BRANCH_B);
    expect(url.searchParams.get("start")).toBe(base.start);
    expect(url.searchParams.get("end")).toBe(base.end);
    await expect(page.getByTestId("vehicle-card").first()).toBeVisible();
  });

  test("rejects a return before the pick-up", async ({ page }) => {
    await page.goto(`/search?${searchQuery({ pickup: BRANCH_A, start: base.end, end: base.start })}`);
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByTestId("vehicle-card")).toHaveCount(0);
  });

  test("rejects a pick-up in the past", async ({ page }) => {
    await page.goto(`/search?${searchQuery({ pickup: BRANCH_A, start: localDateTime(-2), end: localDateTime(1) })}`);
    await expect(page.getByRole("alert")).toBeVisible();
  });

  test("an unknown branch code does not crash the page", async ({ page }) => {
    const res = await page.goto(`/search?${searchQuery({ ...base, pickup: "NOPE" })}`);
    expect(res?.status()).toBeLessThan(500);
  });

  const filterCases: [string, Record<string, string>][] = [
    ["transmission", { transmission: "AUTOMATIC" }],
    ["fuel", { fuel: "ELECTRIC" }],
    ["seats", { seats: "7" }],
    ["price", { minPrice: "100", maxPrice: "200" }],
  ];
  for (const [name, extra] of filterCases) {
    test(`filter by ${name} narrows the results and every card matches`, async ({ page }) => {
      await page.goto(`/search?${searchQuery(base)}`);
      const all = await page.getByTestId("vehicle-card").count();
      expect(all).toBeGreaterThan(0);

      await page.goto(`/search?${searchQuery({ ...base, ...extra })}`);
      const cards = page.getByTestId("vehicle-card");
      const n = await cards.count();
      expect(n).toBeLessThanOrEqual(all);
      for (let i = 0; i < n; i++) {
        const card = cards.nth(i);
        if (extra.transmission) await expect(card).toContainText(/automatic/i);
        if (extra.fuel) await expect(card).toContainText(/electric/i);
        if (extra.seats) {
          const seats = Number((await card.textContent())?.match(/(\d+)\s*seats/i)?.[1]);
          expect(seats).toBeGreaterThanOrEqual(7);
        }
        if (extra.minPrice) {
          const daily = Number(await card.getAttribute("data-daily-fils"));
          expect(daily).toBeGreaterThanOrEqual(100_00);
          expect(daily).toBeLessThanOrEqual(200_00);
        }
      }
    });
  }

  test("filter controls update the URL and keep the search", async ({ page }) => {
    await page.goto(`/search?${searchQuery(base)}`);
    await page.getByTestId("filter-transmission").selectOption("AUTOMATIC");
    await expect(page).toHaveURL(/transmission=AUTOMATIC/);
    await expect(page).toHaveURL(new RegExp(`pickup=${BRANCH_A}`));
  });

  test("sort by price ascending orders the cards", async ({ page }) => {
    await page.goto(`/search?${searchQuery({ ...base, sort: "price" })}`);
    const prices = await page
      .getByTestId("vehicle-card")
      .evaluateAll((els) => els.map((e) => Number(e.getAttribute("data-daily-fils"))));
    expect(prices.length).toBeGreaterThan(1);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
  });
});

test.describe("availability calendar", () => {
  test("vehicle details shows a calendar with day statuses", async ({ page }) => {
    await page.goto(`/search?${searchQuery(base)}`);
    await page.getByTestId("vehicle-card").first().getByRole("link").first().click();
    const cal = page.getByTestId("availability-calendar");
    await expect(cal).toBeVisible();
    const statuses = await cal
      .getByTestId("calendar-day")
      .evaluateAll((els) => els.map((e) => e.getAttribute("data-status")));
    expect(statuses.length).toBeGreaterThanOrEqual(28);
    for (const s of statuses) expect(["available", "booked", "past"]).toContain(s);
  });
});

test.describe("branches", () => {
  test("branch list and details pages render @smoke", async ({ page }) => {
    await page.goto("/branches");
    await expect(page.getByRole("link", { name: new RegExp(BRANCH_A, "i") }).first()).toBeVisible();
    const res = await page.goto(`/branches/${BRANCH_A}`);
    expect(res?.ok()).toBe(true);
    const missing = await page.goto("/branches/NOPE");
    expect(missing?.status()).toBe(404);
  });
});
