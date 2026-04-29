// Playwright config for the OIDC login spec (req 020).
// Driven by `make e2e-dashboard-ci-docker-oidc` via run.sh; the harness
// sets PLAYWRIGHT_BASE_URL to the in-compose oauth2-proxy hostname so
// the browser's redirects resolve through compose-network DNS.
import { defineConfig } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:4180";

function positiveNumberFromEnv(name: string, fallback: number) {
  const parsed = Number(process.env[name] || "");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export default defineConfig({
  testDir: "./tests",
  testMatch: /oidc_login\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  // OIDC discovery + authorize-redirect + callback round-trip is fast,
  // but the very first run starts oidc-mock cold and its ASP.NET
  // initialisation can take 10-15 s. 5 min total is comfortable.
  timeout: positiveNumberFromEnv(
    "INFINITO_E2E_PLAYWRIGHT_TIMEOUT_MS",
    5 * 60_000
  ),
  expect: {
    timeout: 30_000,
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
    // Oidc-mock issues HTTP cookies; oauth2-proxy issues an HTTP cookie
    // because we run with --cookie-secure=false in the test profile.
    ignoreHTTPSErrors: true,
  },
});
