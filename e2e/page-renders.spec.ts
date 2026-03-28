import { test, expect } from "@playwright/test";

/**
 * Smoke tests: verify every page renders without crashing.
 * Auth-protected pages are expected to redirect to /login when unauthenticated.
 */

// ---------------------------------------------------------------------------
// 1-6. Each page either renders content OR redirects to /login
// ---------------------------------------------------------------------------

test.describe("Page render smoke tests (unauthenticated)", () => {
  test("1. /login renders Shaadi Book text with no JS errors", async ({ page }) => {
    const jsErrors: string[] = [];
    page.on("pageerror", (err) => jsErrors.push(err.message));

    await page.goto("/login");
    await expect(page.locator("body")).toContainText("Shaadi Book");
    expect(jsErrors).toEqual([]);
  });

  test("2. / redirects to /login OR renders market feed", async ({ page }) => {
    await page.goto("/");
    const url = page.url();
    const redirectedToLogin = url.includes("/login");
    const hasMarketContent = await page.locator("body").textContent();
    expect(redirectedToLogin || hasMarketContent!.length > 0).toBeTruthy();
  });

  test("3. /wallet redirects to /login OR renders wallet", async ({ page }) => {
    await page.goto("/wallet");
    const url = page.url();
    const redirectedToLogin = url.includes("/login");
    const bodyText = await page.locator("body").textContent();
    expect(redirectedToLogin || bodyText!.includes("wallet") || bodyText!.includes("Wallet")).toBeTruthy();
  });

  test("4. /bets redirects to /login OR renders bets", async ({ page }) => {
    await page.goto("/bets");
    const url = page.url();
    const redirectedToLogin = url.includes("/login");
    const bodyText = await page.locator("body").textContent();
    expect(redirectedToLogin || bodyText!.includes("bet") || bodyText!.includes("Bet")).toBeTruthy();
  });

  test("5. /leaderboard redirects to /login OR renders leaderboard", async ({ page }) => {
    await page.goto("/leaderboard");
    const url = page.url();
    const redirectedToLogin = url.includes("/login");
    const bodyText = await page.locator("body").textContent();
    expect(
      redirectedToLogin ||
      bodyText!.includes("leaderboard") ||
      bodyText!.includes("Leaderboard")
    ).toBeTruthy();
  });

  test("6. /admin redirects to /login OR renders admin", async ({ page }) => {
    await page.goto("/admin");
    const url = page.url();
    const redirectedToLogin = url.includes("/login");
    const bodyText = await page.locator("body").textContent();
    expect(
      redirectedToLogin ||
      bodyText!.includes("admin") ||
      bodyText!.includes("Admin")
    ).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 7-10. Login page detailed checks
// ---------------------------------------------------------------------------

test.describe("Login page element checks", () => {
  test("7. No Unhandled Runtime Error on /login", async ({ page }) => {
    await page.goto("/login");
    // Wait for hydration
    await page.waitForLoadState("networkidle");
    const bodyText = await page.locator("body").textContent();
    expect(bodyText).not.toContain("Unhandled Runtime Error");
  });

  test("8. Continue button exists and is not disabled initially", async ({ page }) => {
    await page.goto("/login");
    const continueBtn = page.locator("button", { hasText: "Continue" });
    await expect(continueBtn).toBeVisible();
    await expect(continueBtn).toBeEnabled();
  });

  test("9. Name input field exists", async ({ page }) => {
    await page.goto("/login");
    const nameInput = page.locator("#name-input");
    await expect(nameInput).toBeVisible();
  });

  test("10. Phone input field exists", async ({ page }) => {
    await page.goto("/login");
    const phoneInput = page.locator('input[type="tel"]');
    await expect(phoneInput).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 11. With fake admin cookie, /admin should NOT redirect to /login
// ---------------------------------------------------------------------------

test.describe("Authenticated admin page", () => {
  test("11. /admin with fake admin cookie does NOT redirect to /login", async ({
    browser,
  }) => {
    // Build a fake JWT: header.payload.signature
    // Payload: {"userId":"test","role":"admin"}
    const fakeJwt = [
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
      "eyJ1c2VySWQiOiJ0ZXN0Iiwicm9sZSI6ImFkbWluIn0",
      "fakesignature",
    ].join(".");

    const context = await browser.newContext();
    await context.addCookies([
      {
        name: "sb_token",
        value: fakeJwt,
        domain: "localhost",
        path: "/",
      },
    ]);

    const page = await context.newPage();
    await page.goto("/admin");
    await page.waitForLoadState("networkidle");

    // Should NOT have been redirected to /login
    expect(page.url()).not.toContain("/login");

    // The page should have rendered something (even if API calls fail)
    const bodyText = await page.locator("body").textContent();
    expect(bodyText!.length).toBeGreaterThan(0);

    await context.close();
  });
});
