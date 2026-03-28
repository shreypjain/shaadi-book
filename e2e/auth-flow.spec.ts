import { test, expect } from "@playwright/test";

test.describe("Auth Flow", () => {
  // -------------------------------------------------------------------------
  // 1. Login page loads without errors
  // -------------------------------------------------------------------------
  test("login page loads without unhandled runtime errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto("/login");
    await expect(page.locator("h1")).toContainText("Shaadi Book");

    // No unhandled JS errors
    expect(errors).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // 2. Name input accepts text
  // -------------------------------------------------------------------------
  test("name input accepts text", async ({ page }) => {
    await page.goto("/login");
    const nameInput = page.locator("#name-input");
    await nameInput.fill("TestBot");
    await expect(nameInput).toHaveValue("TestBot");
  });

  // -------------------------------------------------------------------------
  // 3. Phone input accepts digits and formats them
  // -------------------------------------------------------------------------
  test("phone input accepts digits and formats them", async ({ page }) => {
    await page.goto("/login");
    const phoneInput = page.locator('input[type="tel"]');
    await phoneInput.fill("5551234567");
    // US formatting: (555) 123-4567
    await expect(phoneInput).toHaveValue("(555) 123-4567");
  });

  // -------------------------------------------------------------------------
  // 4. Continue button is visible and clickable
  // -------------------------------------------------------------------------
  test("continue button is visible and clickable", async ({ page }) => {
    await page.goto("/login");
    const continueBtn = page.getByRole("button", { name: "Continue" });
    await expect(continueBtn).toBeVisible();
    await expect(continueBtn).toBeEnabled();
  });

  // -------------------------------------------------------------------------
  // 5. Submitting valid name + phone shows OTP screen or error
  // -------------------------------------------------------------------------
  test("submitting valid credentials shows OTP screen or error", async ({
    page,
  }) => {
    await page.goto("/login");

    // Fill name
    await page.locator("#name-input").fill("TestBot");

    // Fill phone
    await page.locator('input[type="tel"]').fill("5551234567");

    // Click Continue
    await page.getByRole("button", { name: "Continue" }).click();

    // Wait for either the OTP step or an error alert (Twilio may reject test numbers)
    await expect(
      page.locator('text="Enter verification code"').or(
        page.locator('[role="alert"]')
      )
    ).toBeVisible({ timeout: 10000 });
  });

  // -------------------------------------------------------------------------
  // 6–10. Unauthenticated redirects to /login
  // -------------------------------------------------------------------------
  const protectedRoutes = [
    { path: "/", label: "/" },
    { path: "/admin", label: "/admin" },
    { path: "/wallet", label: "/wallet" },
    { path: "/bets", label: "/bets" },
    { path: "/leaderboard", label: "/leaderboard" },
  ];

  for (const route of protectedRoutes) {
    test(`unauthenticated visit to ${route.label} redirects to /login`, async ({
      page,
    }) => {
      await page.goto(route.path);
      await expect(page).toHaveURL(/\/login/);
    });
  }
});
