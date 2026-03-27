import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["./src/__tests__/setup.ts"],
    testTimeout: 30_000,
    hookTimeout: 10_000,
    pool: "forks",
    poolOptions: {
      forks: { singleFork: true },
    },
  },
});
