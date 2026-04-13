import { test, expect } from "@playwright/test";

test.describe("Login Page", () => {
  test("loads login page", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator("h1")).toContainText("Shaadi Book");
    await expect(page.locator("text=Continue")).toBeVisible();
  });

  test("shows validation errors when fields are empty", async ({ page }) => {
    await page.goto("/login");
    await page.click("text=Continue");
    await expect(page.locator("text=Please enter your name")).toBeVisible();
  });

  test("name input is functional", async ({ page }) => {
    await page.goto("/login");
    const nameInput = page.locator("#name-input");
    await nameInput.fill("Test User");
    await expect(nameInput).toHaveValue("Test User");
  });

  test("continue button is clickable with valid input", async ({ page }) => {
    await page.goto("/login");
    const nameInput = page.locator("#name-input");
    await nameInput.fill("Test User");

    // Fill phone via the phone input
    const phoneInput = page.locator('input[type="tel"]');
    await phoneInput.fill("5550001234");

    const continueBtn = page.locator("text=Continue");
    await expect(continueBtn).toBeEnabled();
    await continueBtn.click();

    // Should either show OTP screen or an error (both mean button worked)
    await page.waitForTimeout(2000);
    const hasOtpScreen = await page.locator("text=verification code").isVisible().catch(() => false);
    const hasError = await page.locator('[role="alert"]').isVisible().catch(() => false);
    expect(hasOtpScreen || hasError).toBeTruthy();
  });

  test("unauthenticated user is redirected to login", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe("API Health", () => {
  test("backend health check returns ok", async ({ request }) => {
    const response = await request.get("http://localhost:3001/health");
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.status).toBe("ok");
  });

  test("tRPC proxy works through frontend", async ({ request }) => {
    const response = await request.get("http://localhost:3000/api/trpc/health");
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.result.data.status).toBe("ok");
  });
});
