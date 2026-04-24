import { defineConfig } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000";

export default defineConfig({
  testDir: "./tests",
  testMatch: /(dashboard_deploy_real|dashboard-perf)\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  timeout: 50 * 60_000,
  expect: {
    timeout: 60_000,
  },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    channel: "chromium",
    headless: true,
    trace: "off",
    video: "off",
    screenshot: "only-on-failure",
  },
});
