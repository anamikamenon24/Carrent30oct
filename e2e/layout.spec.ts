import { expect, test } from "@playwright/test";
import { BRANCH_A, localDateTime, searchQuery } from "./helpers";

// Brief: desktop and mobile layouts. Runs on all five Playwright projects (@layout tag).

const pages = [
  "/",
  `/search?${searchQuery({ pickup: BRANCH_A, start: localDateTime(30, 10), end: localDateTime(32, 10) })}`,
  "/branches",
  "/login",
  "/register",
];

for (const path of pages) {
  test(`${path.split("?")[0]} fits the viewport with no console errors @layout`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    const res = await page.goto(path);
    expect(res?.ok(), `status ${res?.status()}`).toBe(true);
    await page.waitForLoadState("networkidle");

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, "horizontal scroll").toBeLessThanOrEqual(0);

    // Every visible button/link is at least 24px tall (tap target) and inside the viewport.
    const bad = await page.locator("a:visible, button:visible").evaluateAll((els) =>
      els
        .map((e) => ({ text: (e.textContent ?? "").trim().slice(0, 30), r: e.getBoundingClientRect() }))
        .filter(({ r }) => r.width > 0 && (r.height < 24 || r.right > window.innerWidth + 1))
        .map(({ text, r }) => `${text} ${Math.round(r.width)}x${Math.round(r.height)} @${Math.round(r.left)}`),
    );
    expect(bad).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test("navigation is reachable on phones @mobile", async ({ page, isMobile }) => {
  test.skip(!isMobile, "phone-only check");
  await page.goto("/");
  const menu = page.getByTestId("nav-menu-button");
  await expect(menu).toBeVisible();
  await menu.click();
  await expect(page.getByRole("link", { name: /log ?in|sign ?in/i })).toBeVisible();
});

test("search form is usable on phones @mobile", async ({ page, isMobile }) => {
  test.skip(!isMobile, "phone-only check");
  await page.goto("/");
  const form = page.getByTestId("search-form");
  await expect(form).toBeVisible();
  const box = await form.boundingBox();
  const vw = page.viewportSize()!.width;
  expect(box!.width).toBeLessThanOrEqual(vw);
  await expect(page.getByTestId("search-submit")).toBeInViewport({ ratio: 0.5 }).catch(async () => {
    await page.getByTestId("search-submit").scrollIntoViewIfNeeded();
    await expect(page.getByTestId("search-submit")).toBeInViewport();
  });
});
