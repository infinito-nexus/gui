import { defineConfig } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000";
const isRealDashboardDeployCi =
  process.env.CI && process.env.INFINITO_E2E_MODE === "ci";

function positiveNumberFromEnv(name: string, fallback: number) {
  const parsed = Number(process.env[name] || "");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export default defineConfig({
  testDir: "./tests",
  testMatch: /(dashboard_deploy_real|dashboard-perf)\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  timeout: positiveNumberFromEnv(
    "INFINITO_E2E_PLAYWRIGHT_TIMEOUT_MS",
    isRealDashboardDeployCi ? 80 * 60_000 : 50 * 60_000
  ),
  expect: {
    timeout: 60_000,
  },
  retries: process.env.CI && !isRealDashboardDeployCi ? 1 : 0,
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
