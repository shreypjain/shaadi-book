import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  retries: 0,
  timeout: 30_000,
  use: {
    baseURL: "http://localhost:3000",
    screenshot: "only-on-failure",
    trace: "on-first-retry",
  },
  projects: [
    {
      // Standard suite — all specs except the payment flow
      name: "chromium",
      use: { browserName: "chromium" },
      testIgnore: ["**/payment-flow.spec.ts"],
    },
    {
      // Payment flow suite — scoped separately because Stripe webhook delivery
      // + ledger update involve multiple async hops and each step in the
      // describe.serial block needs more time than the default 30 s.
      name: "payment-flow",
      use: { browserName: "chromium" },
      testMatch: ["**/payment-flow.spec.ts"],
      timeout: 120_000, // 2 minutes per test step
    },
  ],
});
