import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Use node environment (no jsdom) for backend tests
    environment: "node",
    // Load test env vars before any test file runs
    setupFiles: ["./src/__tests__/setup.ts"],
    // Give DB-heavy integration tests more time
    testTimeout: 30_000,
    // Run tests serially to avoid DB contention across files
    pool: "forks",
    poolOptions: {
      forks: { singleFork: true },
    },
  },
});
