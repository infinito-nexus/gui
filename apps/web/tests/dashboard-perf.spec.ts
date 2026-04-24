import { expect, test, type Browser } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

const WARMUP_REQUESTS = 5;
const MEASURED_SAMPLES = 10;
const FIRST_PAINT_TARGET_MS = 1000;

function percentile(values: number[], pct: number): number {
  if (values.length === 0) return 0;
  if (values.length === 1) return values[0];
  const ordered = [...values].sort((a, b) => a - b);
  const rank = (ordered.length - 1) * pct;
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) return ordered[lower];
  const factor = rank - lower;
  return ordered[lower] + (ordered[upper] - ordered[lower]) * factor;
}

async function warmRoleIndex(baseURL: string) {
  for (let idx = 0; idx < WARMUP_REQUESTS; idx += 1) {
    const response = await fetch(`${baseURL}/api/roles`, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Warm-up GET /api/roles failed with ${response.status}`);
    }
    await response.json();
  }
}

async function warmDashboardRoute(browser: Browser, url: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.locator('[data-testid="role-tile"]').first().waitFor({ state: "visible" });
  await context.close();
}

test("dashboard shows role tiles within 1s on a warm cache", async ({ browser, baseURL }) => {
  expect(baseURL).toBeTruthy();
  const resolvedBaseUrl = String(baseURL);
  await warmRoleIndex(resolvedBaseUrl);
  const dashboardUrl = new URL("/", resolvedBaseUrl);
  dashboardUrl.searchParams.set("sw_scope", "apps");
  await warmDashboardRoute(browser, dashboardUrl.toString());

  const samples: { name: string; value_ms: number; timestamp: number }[] = [];
  const measuredValues: number[] = [];

  for (let idx = 0; idx < MEASURED_SAMPLES; idx += 1) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const startedAt = Date.now();
    await page.goto(dashboardUrl.toString(), { waitUntil: "domcontentloaded" });
    await page.locator('[data-testid="role-tile"]').first().waitFor({ state: "visible" });
    const elapsedMs = Date.now() - startedAt;
    measuredValues.push(elapsedMs);
    samples.push({
      name: "dashboard first tile visible",
      value_ms: elapsedMs,
      timestamp: Date.now() / 1000,
    });
    await context.close();
  }

  const summary = {
    p50: Number(percentile(measuredValues, 0.5).toFixed(3)),
    p95: Number(percentile(measuredValues, 0.95).toFixed(3)),
    p99: Number(percentile(measuredValues, 0.99).toFixed(3)),
    max: Number(Math.max(...measuredValues).toFixed(3)),
    count: measuredValues.length,
  };
  const observed = Number(Math.max(...measuredValues).toFixed(3));
  const status = observed < FIRST_PAINT_TARGET_MS ? "pass" : "fail";
  const failureMessages =
    status === "pass"
      ? []
      : [
          `first_tile_visible_ms violated: observed=${observed} target=${FIRST_PAINT_TARGET_MS} context=${JSON.stringify({
            sample_count: measuredValues.length,
            max_sample_ms: observed,
          })}`,
        ];

  const outputDir = path.resolve(process.cwd(), "..", "..", "state", "perf", "016");
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(
    path.join(outputDir, "dashboard-first-paint.json"),
    `${JSON.stringify(
      {
        samples,
        summary,
        thresholds: {
          first_tile_visible_ms: {
            target: FIRST_PAINT_TARGET_MS,
            observed,
            context: {
              sample_count: measuredValues.length,
              max_sample_ms: observed,
            },
            status,
          },
        },
        failure_messages: failureMessages,
        status,
      },
      null,
      2
    )}\n`,
    "utf-8"
  );

  expect(observed).toBeLessThan(FIRST_PAINT_TARGET_MS);
});
