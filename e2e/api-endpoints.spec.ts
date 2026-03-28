import { test, expect } from "@playwright/test";

const BACKEND = "http://localhost:3001";
const FRONTEND = "http://localhost:3000";

test.describe("API Endpoints", () => {
  // 1. GET /health returns 200 with { status: "ok" }
  test("GET /health returns 200 with status ok", async ({ request }) => {
    const response = await request.get(`${BACKEND}/health`);
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.status).toBe("ok");
  });

  // 2. GET /api/trpc/health via frontend proxy returns 200 with valid tRPC response
  test("GET /api/trpc/health returns valid tRPC response via frontend proxy", async ({
    request,
  }) => {
    const response = await request.get(`${FRONTEND}/api/trpc/health`);
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.result).toBeDefined();
    expect(body.result.data).toBeDefined();
    expect(body.result.data.status).toBe("ok");
  });

  // 3. POST auth.sendOTP — should return success or Twilio error, not a 500 crash
  test("POST auth.sendOTP returns success or Twilio error (not 500 crash)", async ({
    request,
  }) => {
    const response = await request.post(`${BACKEND}/trpc/auth.sendOTP`, {
      data: { phone: "0000000000", country: "US", name: "Test" },
    });
    // tRPC returns 200 for success, or 500 for INTERNAL_SERVER_ERROR (Twilio failure)
    // Both are acceptable — a raw crash / connection refused is not
    expect([200, 500]).toContain(response.status());
    const body = await response.json();
    // If success, we get result.data.status === "pending"
    // If Twilio error, we get error.message about OTP
    if (response.status() === 200) {
      expect(body.result.data.status).toBe("pending");
    } else {
      expect(body.error).toBeDefined();
      expect(body.error.message).toBeDefined();
    }
  });

  // 4. GET market.list with status=ACTIVE returns 200
  test("GET market.list with ACTIVE status returns 200", async ({ request }) => {
    const input = encodeURIComponent(JSON.stringify({ status: "ACTIVE" }));
    const response = await request.get(
      `${BACKEND}/trpc/market.list?input=${input}`
    );
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.result).toBeDefined();
    expect(body.result.data).toBeDefined();
    // Data should be an array (possibly empty)
    expect(Array.isArray(body.result.data)).toBe(true);
  });

  // 5. GET bets.myPositions without auth returns 401 or UNAUTHORIZED
  test("GET bets.myPositions without auth returns UNAUTHORIZED", async ({
    request,
  }) => {
    const response = await request.get(`${BACKEND}/trpc/bets.myPositions`);
    const body = await response.json();
    // tRPC returns 401 for UNAUTHORIZED
    const isUnauthorized =
      response.status() === 401 ||
      body?.error?.code === "UNAUTHORIZED" ||
      body?.error?.data?.code === "UNAUTHORIZED";
    expect(isUnauthorized).toBe(true);
  });

  // 6. GET wallet.balance without auth returns 401 or UNAUTHORIZED
  test("GET wallet.balance without auth returns UNAUTHORIZED", async ({
    request,
  }) => {
    const response = await request.get(`${BACKEND}/trpc/wallet.balance`);
    const body = await response.json();
    const isUnauthorized =
      response.status() === 401 ||
      body?.error?.code === "UNAUTHORIZED" ||
      body?.error?.data?.code === "UNAUTHORIZED";
    expect(isUnauthorized).toBe(true);
  });

  // 7. GET leaderboard.list returns 200 (public endpoint)
  test("GET leaderboard.list returns 200", async ({ request }) => {
    const response = await request.get(`${BACKEND}/trpc/leaderboard.list`);
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.result).toBeDefined();
    expect(body.result.data).toBeDefined();
  });

  // 8. GET leaderboard.charityTotal returns 200 (public endpoint)
  test("GET leaderboard.charityTotal returns 200", async ({ request }) => {
    const response = await request.get(
      `${BACKEND}/trpc/leaderboard.charityTotal`
    );
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.result).toBeDefined();
    expect(body.result.data).toBeDefined();
  });

  // 9. GET admin.dashboard without auth returns 401 or UNAUTHORIZED
  test("GET admin.dashboard without auth returns UNAUTHORIZED", async ({
    request,
  }) => {
    const response = await request.get(`${BACKEND}/trpc/admin.dashboard`);
    const body = await response.json();
    const isUnauthorized =
      response.status() === 401 ||
      body?.error?.code === "UNAUTHORIZED" ||
      body?.error?.data?.code === "UNAUTHORIZED";
    expect(isUnauthorized).toBe(true);
  });

  // 10. POST market.buy without auth returns 401 or UNAUTHORIZED
  test("POST market.buy without auth returns UNAUTHORIZED", async ({
    request,
  }) => {
    const response = await request.post(`${BACKEND}/trpc/market.buy`, {
      data: {
        marketId: "nonexistent",
        outcomeId: "nonexistent",
        dollarAmountCents: 100,
      },
    });
    const body = await response.json();
    const isUnauthorized =
      response.status() === 401 ||
      body?.error?.code === "UNAUTHORIZED" ||
      body?.error?.data?.code === "UNAUTHORIZED";
    expect(isUnauthorized).toBe(true);
  });
});
