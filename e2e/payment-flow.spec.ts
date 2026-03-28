/**
 * Payment Flow E2E — e2e/payment-flow.spec.ts
 *
 * Exercises the full deposit → balance update → bet → position flow.
 *
 * ┌─────────────────────────────────────────────────────────────────┐
 * │  Step 1  │ Login (inject JWT into localStorage — bypasses OTP)  │
 * │  Step 2  │ Navigate to /wallet — verify page loads              │
 * │  Step 3  │ Open deposit modal — verify amount selection UI      │
 * │  Step 4  │ Intercept tRPC createDeposit call — mock clientSecret│
 * │  Step 5  │ Simulate Stripe webhook (payment_intent.succeeded)   │
 * │  Step 6  │ Reload /wallet — verify balance shows deposit amount │
 * │  Step 7  │ Admin creates a test market via API                  │
 * │  Step 8  │ Navigate to market page — verify it renders          │
 * │  Step 9  │ Place a bet via tRPC API (user has enough balance)   │
 * │  Step 10 │ Verify position created via bets.myPositions         │
 * └─────────────────────────────────────────────────────────────────┘
 *
 * Auth strategy: OTP is bypassed by writing a JWT + user profile directly
 * into localStorage before navigating to protected pages. The JWT is signed
 * with the same JWT_SECRET the backend uses.
 *
 * Stripe strategy: No real card is charged. We:
 *   a) Intercept payment.createDeposit in the browser and return a mock
 *      clientSecret so the UI can advance to the payment step.
 *   b) POST a correctly-signed payment_intent.succeeded event directly to
 *      the backend's /api/webhooks/stripe endpoint.
 *
 * Prerequisites:
 *   - Backend on http://localhost:3001
 *   - Frontend on http://localhost:3000
 *   - Postgres accessible at DATABASE_URL (or default dev URL)
 *   - JWT_SECRET env var set (matches backend)
 *   - STRIPE_WEBHOOK_SECRET env var set (matches backend)
 *   - jsonwebtoken available in node_modules (monorepo transitive dep)
 */

import { test, expect } from "@playwright/test";
import {
  createTestUser,
  creditUser,
  injectAuthState,
  trpcQuery,
  trpcMutate,
  getUserIdByPhone,
  signJwt,
  psql,
  BACKEND,
  type TestUser,
} from "./helpers/auth";
import {
  simulatePaymentIntentSucceeded,
  testPaymentIntentId,
} from "./helpers/stripe-mock";

// ---------------------------------------------------------------------------
// Test-scoped constants
// ---------------------------------------------------------------------------

/** Unique IDs so parallel runs / re-runs don't collide */
const TEST_USER_ID = "e2ef0001-0000-0000-0000-000000000001";
const TEST_USER_PHONE = "+15550199001";
const DEPOSIT_CENTS = 2500; // $25.00
const BET_CENTS = 500;      // $5.00

/** Deterministic PaymentIntent ID for idempotency */
const PAYMENT_INTENT_ID = testPaymentIntentId("payment-flow-e2e-v1");

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

test.describe.serial("Full Payment Flow", () => {
  let testUser: TestUser;
  let adminToken: string;
  let marketId: string;
  let outcomeId: string; // "Yes" outcome

  // -------------------------------------------------------------------------
  // Before all: seed DB
  // -------------------------------------------------------------------------
  test.beforeAll(() => {
    // 1. Create (or re-use) the E2E test user
    testUser = createTestUser({
      userId: TEST_USER_ID,
      name: "E2E PaymentBot",
      phone: TEST_USER_PHONE,
      country: "US",
      role: "GUEST",
    });

    // 2. Mint an admin token (look up the real admin user, or create one)
    let adminId = getUserIdByPhone("+15550000001");
    if (!adminId) {
      // Fallback: create a temporary admin user for this test run
      const admin = createTestUser({
        userId: "e2ef0000-0000-0000-0000-000000000000",
        name: "E2E Admin",
        phone: "+15550199000",
        role: "ADMIN",
      });
      adminId = admin.userId;
      adminToken = admin.token;
    } else {
      adminToken = signJwt({ userId: adminId, role: "admin", phone: "+15550000001" });
    }
  });

  // =========================================================================
  // STEP 1: Login (inject auth state, bypassing OTP)
  // =========================================================================
  test("Step 1: Login — inject JWT into localStorage", async ({ page }) => {
    // Inject auth state directly instead of going through Twilio OTP
    await injectAuthState(page, testUser);

    // Navigate to home (protected route) — should NOT redirect to /login
    await page.goto("/");
    await expect(page).not.toHaveURL(/\/login/);

    // Verify we see the app shell (not the login page)
    const loginHeading = page.locator("h1:has-text('Shaadi Book')").first();
    // On the home page the main heading should NOT be the login card heading
    await expect(page).not.toHaveURL(/\/login/);
  });

  // =========================================================================
  // STEP 2: Navigate to /wallet — verify page loads
  // =========================================================================
  test("Step 2: Wallet page loads for authenticated user", async ({ page }) => {
    await injectAuthState(page, testUser);
    await page.goto("/wallet");

    // Wallet page heading
    await expect(page.locator("h1:has-text('My Wallet')")).toBeVisible({ timeout: 10_000 });

    // Balance display is present (may show $0.00 before deposit)
    await expect(page.locator("text=Add Credits")).toBeVisible();
    await expect(page.locator("text=Withdraw")).toBeVisible();
  });

  // =========================================================================
  // STEP 3 & 4: Open deposit modal — verify amount selection UI,
  //             intercept createDeposit tRPC call and mock response
  // =========================================================================
  test("Step 3+4: Deposit modal — amount selection UI + mocked API call", async ({
    page,
  }) => {
    await injectAuthState(page, testUser);
    await page.goto("/wallet");
    await expect(page.locator("h1:has-text('My Wallet')")).toBeVisible();

    // Intercept the tRPC payment.createDeposit mutation to avoid real Stripe API call.
    // The route matches the POST to /api/trpc/payment.createDeposit (proxied through Next.js).
    await page.route("**/api/trpc/payment.createDeposit**", async (route) => {
      // Return a mock clientSecret so the UI advances to the payment step
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          result: {
            data: {
              clientSecret: `${PAYMENT_INTENT_ID}_secret_test`,
            },
          },
        }),
      });
    });

    // Also intercept payment.getPublishableKey so loadStripe() doesn't error
    await page.route("**/api/trpc/payment.getPublishableKey**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          result: {
            data: {
              publishableKey:
                "REDACTED_STRIPE_TEST_PUBLISHABLE_KEY",
            },
          },
        }),
      });
    });

    // Open the deposit modal
    await page.locator("text=Add Credits").first().click();

    // Verify the modal appears with amount selection
    await expect(page.locator("text=Add Credits").nth(1)).toBeVisible({ timeout: 5000 });
    await expect(page.locator("text=Charged in USD via Stripe")).toBeVisible();

    // Preset buttons should be visible
    await expect(page.locator("button:has-text('$10')")).toBeVisible();
    await expect(page.locator("button:has-text('$25')")).toBeVisible();
    await expect(page.locator("button:has-text('$50')")).toBeVisible();

    // Select $25 preset
    await page.locator("button:has-text('$25')").click();

    // Click "Continue with $25.00 →"
    const continueBtn = page.locator("button", { hasText: /Continue with/ });
    await expect(continueBtn).toBeEnabled();

    // Track whether the mocked API was called
    let createDepositCalled = false;
    page.on("request", (req) => {
      if (req.url().includes("payment.createDeposit")) {
        createDepositCalled = true;
      }
    });

    await continueBtn.click();

    // Wait for the mock to be called and UI to advance to the payment step
    await page.waitForTimeout(1500);
    expect(createDepositCalled).toBe(true);

    // The payment step should appear (shows "Payment" heading)
    // Note: The Stripe Elements widget itself won't load with a fake clientSecret,
    // but we've verified the API was called and the UI reacted correctly.
    await expect(
      page.locator("text=Payment").or(page.locator("text=Setting up payment"))
    ).toBeVisible({ timeout: 5000 });
  });

  // =========================================================================
  // STEP 5: Simulate Stripe webhook — payment_intent.succeeded
  // =========================================================================
  test("Step 5: Simulate Stripe webhook (payment_intent.succeeded)", async ({
    request,
  }) => {
    const result = await simulatePaymentIntentSucceeded(request, {
      userId: testUser.userId,
      amountCents: DEPOSIT_CENTS,
      paymentIntentId: PAYMENT_INTENT_ID,
    });

    expect(result.ok, `Webhook returned ${result.status}: ${JSON.stringify(result.body)}`).toBe(true);
    expect(result.status).toBe(200);
    expect((result.body as Record<string, unknown>).received).toBe(true);

    console.log(`✓ Webhook delivered — credited $${DEPOSIT_CENTS / 100} to ${testUser.name}`);
  });

  // =========================================================================
  // STEP 6: Reload /wallet — verify balance shows the deposited amount
  // =========================================================================
  test("Step 6: Wallet shows updated balance after deposit", async ({ page, request }) => {
    // First verify via API that the balance is correct
    const balanceResult = (await trpcQuery(
      request,
      "wallet.balance",
      undefined,
      testUser.token
    )) as { result?: { data?: { balanceCents?: number } } };

    const balanceCents = balanceResult.result?.data?.balanceCents ?? 0;
    expect(balanceCents).toBeGreaterThanOrEqual(DEPOSIT_CENTS);
    console.log(
      `✓ API balance: $${(balanceCents / 100).toFixed(2)} ` +
        `(expected ≥ $${(DEPOSIT_CENTS / 100).toFixed(2)})`
    );

    // Also verify via the UI
    await injectAuthState(page, testUser);
    await page.goto("/wallet");
    await expect(page.locator("h1:has-text('My Wallet')")).toBeVisible();

    // Wait for balance to load and display a non-zero amount.
    // The BalanceDisplay component renders the balance in dollars.
    const expectedDollars = `$${(DEPOSIT_CENTS / 100).toFixed(2)}`;
    await expect(
      page.locator(`text=${expectedDollars}`)
    ).toBeVisible({ timeout: 10_000 });

    // Also verify the deposit shows up in transaction history
    await expect(page.locator("text=Deposit")).toBeVisible();
    console.log(`✓ UI shows ${expectedDollars} balance and Deposit transaction`);
  });

  // =========================================================================
  // STEP 7: Admin creates a test market
  // =========================================================================
  test("Step 7: Admin creates a test market via tRPC", async ({ request }) => {
    const result = (await trpcMutate(
      request,
      "market.create",
      {
        question: "Will the E2E payment test pass on the first run?",
        outcomeLabels: ["Yes", "No"],
      },
      adminToken
    )) as { result?: { data?: { id: string; outcomes: Array<{ id: string; label: string }> } } };

    expect(result.result?.data?.id, `market.create failed: ${JSON.stringify(result)}`).toBeTruthy();

    marketId = result.result!.data!.id;
    const yesOutcome = result.result!.data!.outcomes.find((o) => o.label === "Yes");
    expect(yesOutcome).toBeTruthy();
    outcomeId = yesOutcome!.id;

    console.log(`✓ Market created: ${marketId} (Yes outcome: ${outcomeId})`);
  });

  // =========================================================================
  // STEP 8: Navigate to market page — verify it renders
  // =========================================================================
  test("Step 8: Market detail page renders for authenticated user", async ({
    page,
  }) => {
    // marketId must be set from the previous step
    expect(marketId, "marketId not set — step 7 must run first").toBeTruthy();

    await injectAuthState(page, testUser);
    await page.goto(`/markets/${marketId}`);

    // The market question should appear
    await expect(
      page.locator("h1:has-text('Will the E2E payment test pass')")
    ).toBeVisible({ timeout: 10_000 });

    // Outcome labels should be shown
    await expect(page.locator("text=Yes")).toBeVisible();
    await expect(page.locator("text=No")).toBeVisible();

    // "Place a Bet" section should be visible (market is ACTIVE)
    await expect(page.locator("text=Place a Bet")).toBeVisible();

    console.log(`✓ Market page /markets/${marketId} renders correctly`);
  });

  // =========================================================================
  // STEP 9: Place a bet via tRPC (user has enough balance)
  // =========================================================================
  test("Step 9: Place a bet on the market", async ({ request }) => {
    expect(marketId, "marketId not set").toBeTruthy();
    expect(outcomeId, "outcomeId not set").toBeTruthy();

    // Verify balance is sufficient before betting
    const balanceResult = (await trpcQuery(
      request,
      "wallet.balance",
      undefined,
      testUser.token
    )) as { result?: { data?: { balanceCents?: number } } };
    const balanceCents = balanceResult.result?.data?.balanceCents ?? 0;
    expect(balanceCents).toBeGreaterThanOrEqual(BET_CENTS);

    // Place the bet
    const betResult = (await trpcMutate(
      request,
      "market.buy",
      {
        marketId,
        outcomeId,
        dollarAmountCents: BET_CENTS,
      },
      testUser.token
    )) as { result?: { data?: { sharesDelta?: number; priceAfterCents?: number } }; error?: { message?: string } };

    if (!betResult.result?.data) {
      console.log(`Bet result: ${JSON.stringify(betResult)}`);
    }

    expect(
      betResult.result?.data,
      `market.buy failed: ${betResult.error?.message ?? JSON.stringify(betResult)}`
    ).toBeTruthy();

    const { sharesDelta, priceAfterCents } = betResult.result!.data!;
    expect(sharesDelta).toBeGreaterThan(0);

    console.log(
      `✓ Bet placed: $${BET_CENTS / 100} on "Yes" → ` +
        `${sharesDelta?.toFixed(4)} shares @ ${priceAfterCents}¢`
    );
  });

  // =========================================================================
  // STEP 10: Verify position created — bets.myPositions API + UI
  // =========================================================================
  test("Step 10: Verify position appears in myPositions API + bets page UI", async ({
    page,
    request,
  }) => {
    // 10a. API check
    const positionsResult = (await trpcQuery(
      request,
      "bets.myPositions",
      undefined,
      testUser.token
    )) as {
      result?: {
        data?: Array<{
          marketId: string;
          outcomeId?: string;
          outcomeLabel?: string;
          outcome?: string;
          shares?: number;
          avgPriceCents?: number;
        }>;
      };
    };

    const positions = positionsResult.result?.data ?? [];
    const ourPosition = positions.find((p) => p.marketId === marketId);

    expect(
      ourPosition,
      `No position found for market ${marketId}. Positions: ${JSON.stringify(positions)}`
    ).toBeTruthy();

    const shares = ourPosition?.shares ?? 0;
    expect(shares).toBeGreaterThan(0);

    const outcomeLabel = ourPosition?.outcomeLabel ?? ourPosition?.outcome ?? "";
    expect(outcomeLabel.toLowerCase()).toContain("yes");

    console.log(
      `✓ Position found: ${shares.toFixed(4)} shares of "${outcomeLabel}" ` +
        `@ avg ${ourPosition?.avgPriceCents}¢`
    );

    // 10b. UI check — navigate to /bets and confirm the position card
    await injectAuthState(page, testUser);
    await page.goto("/bets");

    // Wait for the bets page to load
    await page.waitForLoadState("networkidle");

    // The market question should appear in the positions list
    const marketText = page.locator("text=Will the E2E payment test pass");
    await expect(marketText).toBeVisible({ timeout: 10_000 });

    // The "Yes" label should appear near the position
    await expect(page.locator("text=Yes").first()).toBeVisible();

    console.log("✓ Position visible on /bets UI page");
  });

  // =========================================================================
  // Bonus: verify wallet balance decreased by bet amount
  // =========================================================================
  test("Bonus: wallet balance reflects bet deduction", async ({ request }) => {
    const balanceResult = (await trpcQuery(
      request,
      "wallet.balance",
      undefined,
      testUser.token
    )) as { result?: { data?: { balanceCents?: number } } };

    const balanceCents = balanceResult.result?.data?.balanceCents ?? 0;
    const expectedMax = DEPOSIT_CENTS - BET_CENTS;

    // Balance should be less than the deposited amount (bet was deducted)
    expect(balanceCents).toBeLessThan(DEPOSIT_CENTS);
    expect(balanceCents).toBeGreaterThanOrEqual(0);

    console.log(
      `✓ Post-bet balance: $${(balanceCents / 100).toFixed(2)} ` +
        `(deposited $${DEPOSIT_CENTS / 100}, bet $${BET_CENTS / 100})`
    );
  });
});

// ---------------------------------------------------------------------------
// Standalone: verify login page UI works end-to-end (OTP form flow)
// ---------------------------------------------------------------------------

test.describe("Login Page Flow (UI only — no real OTP)", () => {
  test("login page renders and name/phone inputs work", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator("h1:has-text('Shaadi Book')")).toBeVisible();

    // Fill name
    await page.locator("#name-input").fill("E2E Test Guest");
    await expect(page.locator("#name-input")).toHaveValue("E2E Test Guest");

    // Fill phone (US 10-digit)
    const phoneInput = page.locator('input[type="tel"]');
    await phoneInput.fill("5551990001");
    // The PhoneInput component formats as (555) 199-0001
    await expect(phoneInput).toHaveValue("(555) 199-0001");

    // Continue button is visible and enabled
    const continueBtn = page.getByRole("button", { name: "Continue" });
    await expect(continueBtn).toBeVisible();
    await expect(continueBtn).toBeEnabled();
  });

  test("empty form shows validation error on submit", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Continue" }).click();
    // Should show name validation error
    await expect(page.locator('[role="alert"]').or(page.locator("text=Please enter"))).toBeVisible({ timeout: 5000 });
  });

  test("submitting valid credentials transitions to OTP step or shows error", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.locator("#name-input").fill("E2E OTP Test");
    const phoneInput = page.locator('input[type="tel"]');
    await phoneInput.fill("5559999999");

    await page.getByRole("button", { name: "Continue" }).click();

    // Either the OTP screen appears or Twilio returns an error
    await expect(
      page.locator("text=Enter verification code").or(page.locator('[role="alert"]'))
    ).toBeVisible({ timeout: 12_000 });
  });
});

// ---------------------------------------------------------------------------
// Standalone: authenticated redirect + wallet page (using injected auth)
// ---------------------------------------------------------------------------

test.describe("Authenticated Routes (injected JWT)", () => {
  const ROUTE_USER_ID = "e2ef0002-0000-0000-0000-000000000002";
  const ROUTE_USER_PHONE = "+15550199002";

  let routeUser: TestUser;

  test.beforeAll(() => {
    routeUser = createTestUser({
      userId: ROUTE_USER_ID,
      name: "E2E RouteBot",
      phone: ROUTE_USER_PHONE,
      country: "US",
      role: "GUEST",
    });
    // Give them a small balance for UI rendering
    creditUser(ROUTE_USER_ID, 1000, "route-bot-seed");
  });

  test("authenticated user can access /wallet", async ({ page }) => {
    await injectAuthState(page, routeUser);
    await page.goto("/wallet");
    await expect(page.locator("h1:has-text('My Wallet')")).toBeVisible({ timeout: 10_000 });
    await expect(page).not.toHaveURL(/\/login/);
  });

  test("authenticated user can access /bets", async ({ page }) => {
    await injectAuthState(page, routeUser);
    await page.goto("/bets");
    // Should stay on /bets (not redirect to /login)
    await expect(page).not.toHaveURL(/\/login/, { timeout: 5000 });
    // Page should load without crashing
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.waitForLoadState("networkidle");
    expect(errors).toHaveLength(0);
  });

  test("authenticated user can access /leaderboard", async ({ page }) => {
    await injectAuthState(page, routeUser);
    await page.goto("/leaderboard");
    await expect(page).not.toHaveURL(/\/login/, { timeout: 5000 });
  });

  test("unauthenticated user is redirected from /wallet to /login", async ({
    page,
  }) => {
    // Don't inject auth state
    await page.goto("/wallet");
    await expect(page).toHaveURL(/\/login/, { timeout: 5000 });
  });
});
