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
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],

  // Override timeout for the payment flow suite — Stripe webhook + balance
  // update involve multiple async hops and need a longer deadline.
  // Individual test timeouts are inherited from the project default (30s)
  // but the full describe.serial block can take longer.
  globalTimeout: 10 * 60 * 1000, // 10 minutes per full run
});
