import { expect, test } from "@playwright/test";
import { login, logout, newUser, register } from "./helpers";

// Brief: registration, login, logout and authorization.

test.describe("authentication", () => {
  test("register, logout, log back in @smoke", async ({ page }) => {
    const user = newUser();
    await register(page, user);
    await page.goto("/profile");
    await expect(page.getByText(user.email)).toBeVisible();

    await logout(page);
    await page.goto("/profile");
    await expect(page).toHaveURL(/\/login/);

    await login(page, user);
    await page.goto("/profile");
    await expect(page.getByText(user.email)).toBeVisible();
  });

  test("rejects a wrong password without revealing whether the email exists", async ({ page }) => {
    const user = newUser();
    await register(page, user);
    await logout(page);

    await page.goto("/login");
    await page.getByLabel(/email/i).fill(user.email);
    await page.getByLabel(/password/i).fill("wrong-password-123");
    await page.getByRole("button", { name: /log ?in|sign ?in/i }).click();
    const wrongPw = page.getByRole("alert");
    await expect(wrongPw).toBeVisible();
    const msgWrongPw = (await wrongPw.textContent())?.trim();
    await expect(page).toHaveURL(/\/login/);

    await page.goto("/login");
    await page.getByLabel(/email/i).fill(`nobody-${Date.now()}@example.test`);
    await page.getByLabel(/password/i).fill("wrong-password-123");
    await page.getByRole("button", { name: /log ?in|sign ?in/i }).click();
    await expect(page.getByRole("alert")).toHaveText(msgWrongPw ?? "");
  });

  test("rejects a duplicate registration", async ({ page }) => {
    const user = newUser();
    await register(page, user);
    await logout(page);
    await page.goto("/register");
    await page.getByLabel(/full name/i).fill(user.name);
    await page.getByLabel(/email/i).fill(user.email);
    await page.getByLabel(/^password/i).first().fill(user.password);
    const confirm = page.getByLabel(/confirm password/i);
    if (await confirm.count()) await confirm.fill(user.password);
    await page.getByRole("button", { name: /register|sign up|create account/i }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page).toHaveURL(/\/register/);
  });

  test("session cookie is httpOnly", async ({ page, context }) => {
    await register(page, newUser());
    const cookies = await context.cookies();
    const session = cookies.filter((c) => /session/i.test(c.name));
    expect(session.length).toBeGreaterThan(0);
    for (const c of session) expect(c.httpOnly, c.name).toBe(true);
  });

  test("repeated wrong passwords through the login form are throttled", async ({ page }) => {
    const user = newUser("brute");
    await register(page, user);
    await logout(page);
    let throttled = false;
    for (let i = 0; i < 12 && !throttled; i++) {
      await page.goto("/login");
      await page.getByLabel(/email/i).fill(user.email);
      await page.getByLabel(/password/i).fill(`wrong-${i}-password`);
      await page.getByRole("button", { name: /log ?in|sign ?in/i }).click();
      const alert = page.getByRole("alert");
      await expect(alert).toBeVisible();
      throttled = /too many|try again (later|in)/i.test((await alert.textContent()) ?? "");
    }
    expect(throttled, "12 wrong passwords in a row were never rate-limited").toBe(true);
  });

  test("the raw auth API cannot be used to become an admin", async ({ page, request, baseURL }) => {
    const user = newUser("escalate");
    const signUp = await request.post("/api/auth/sign-up/email", {
      data: { name: user.name, email: user.email, password: user.password, role: "ADMIN" },
      headers: { origin: baseURL! },
    });
    // Either rejected outright or created as a customer.
    if (signUp.ok()) {
      await request.post("/api/auth/update-user", { data: { role: "ADMIN" }, headers: { origin: baseURL! } });
      await login(page, user);
      const res = await page.goto("/admin");
      expect(res?.status()).toBe(404);
    } else {
      expect(signUp.status()).toBeLessThan(500);
    }
  });

  for (const path of ["/rentals", "/profile", "/admin"]) {
    test(`anonymous visitors are sent to login from ${path}`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login/);
    });
  }
});
