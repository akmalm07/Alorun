import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests",
  testMatch: "*.spec.ts",
  workers: 1,
  timeout: 40_000,
  expect: { timeout: 6_000 },
  reporter: "list",
});
