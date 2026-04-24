import { execFileSync } from "node:child_process";

import { expect, test, type Page } from "@playwright/test";

const MASTER_PASSWORD = "vault-pass-014";
const ROLE_ID = "web-app-dashboard";
const TARGET_ALIAS = "device";
const DASHBOARD_HTTP_URL = "http://127.0.0.1:8029/";
const DEPLOYMENT_COMPLETION_TIMEOUT_MS = 40 * 60_000;
const LIVE_LOG_RENDER_DELAY_LIMIT_MS = 30_000;
const ADMINISTRATOR_AUTHORIZED_KEY =
  "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKKBS2UWGKi9IRz2b+JjkAWGiAkFDrxnnQXiueLQTKDz infinito-test";
const observedWorkspaceIds = new Set<string>();

function composeArgs(...args: string[]): string[] {
  const composeEnvFile = process.env.INFINITO_E2E_COMPOSE_ENV_FILE;
  const composeFile = process.env.INFINITO_E2E_COMPOSE_FILE;
  const out: string[] = ["compose"];
  if (composeEnvFile) {
    out.push("--env-file", composeEnvFile);
  }
  if (composeFile) {
    out.push("-f", composeFile);
  }
  out.push("--profile", "test", ...args);
  return out;
}

function runCompose(...args: string[]): string {
  return execFileSync("docker", composeArgs(...args), {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

async function switchToAppsScope(page: Page) {
  const scopeToggle = page.getByRole("button", { name: "Toggle apps and bundles" });
  await expect(scopeToggle).toBeVisible();
  if ((await scopeToggle.textContent())?.includes("Bundles")) {
    await scopeToggle.click();
  }
  await expect(scopeToggle).toContainText("Apps");
}

async function waitForWorkspaceId(page: Page) {
  const workspaceSummary = page
    .locator("[role='tabpanel'][data-panel-key='inventory'] [data-workspace-id]")
    .first();
  let workspaceId: string | null = null;
  await expect
    .poll(
      async () => {
        const value = (await workspaceSummary.getAttribute("data-workspace-id")) || "";
        if (!value || value === "creating") {
          return null;
        }
        workspaceId = value;
        return value;
      },
      { timeout: 60_000 }
    )
    .toMatch(/^[a-z0-9-]+$/);
  return workspaceId ?? "";
}

async function csrfHeaders(page: Page) {
  let csrfToken = "";
  let cookieHeader = "";
  await expect
    .poll(
      async () => {
        const cookies = await page.context().cookies();
        csrfToken = cookies.find((cookie) => cookie.name === "csrf")?.value || "";
        cookieHeader = cookies
          .map((cookie) => `${cookie.name}=${cookie.value}`)
          .join("; ");
        return csrfToken;
      },
      { timeout: 10_000 }
    )
    .not.toBe("");
  return {
    Cookie: cookieHeader,
    "X-CSRF": csrfToken,
  };
}

async function assertDashboardReachable() {
  await expect
    .poll(
      () => {
        try {
          const output = runCompose(
            "exec",
            "-T",
            "ssh-password",
            "bash",
            "-lc",
            `curl -fsS -o /dev/null -w '%{http_code}' ${DASHBOARD_HTTP_URL}`
          );
          return output.match(/(\d{3})\s*$/)?.[1] ?? "000";
        } catch {
          return "000";
        }
      },
      {
        timeout: 120_000,
        intervals: [1_000, 2_000, 5_000],
      }
    )
    .toBe("200");
}

async function readLatencyProbe(page: Page) {
  return page.evaluate(() => {
    const probe = document.querySelector(
      '[data-testid="live-log-latency-probe"]'
    ) as HTMLElement | null;
    const samples = Array.from(
      document.querySelectorAll('[data-testid="live-log-latency-sample"]')
    )
      .slice(-5)
      .map((node) => String(node.textContent || "").trim())
      .filter(Boolean);

    const readInt = (value: string | undefined) => {
      const parsed = Number(value || 0);
      return Number.isFinite(parsed) ? parsed : 0;
    };

    return {
      errorEventCount: readInt(probe?.dataset.errorEventCount),
      latencyOk: probe?.dataset.latencyOk !== "false",
      lastStatus: String(probe?.dataset.lastStatus || ""),
      maxDelayMs: readInt(probe?.dataset.maxDelayMs),
      openEventCount: readInt(probe?.dataset.openEventCount),
      observedCount: readInt(probe?.dataset.observedCount),
      receivedLineCount: readInt(probe?.dataset.receivedLineCount),
      sampleCount: samples.length,
      recentSamples: samples,
      statusEventCount: readInt(probe?.dataset.statusEventCount),
      violationDelayMs: readInt(probe?.dataset.violationDelayMs),
      violationLine: String(probe?.dataset.violationLine || ""),
    };
  });
}

function formatLatencyProbe(probe: Awaited<ReturnType<typeof readLatencyProbe>>) {
  return JSON.stringify(probe);
}

async function assertNoLatencyViolation(page: Page) {
  const probe = await readLatencyProbe(page);
  if (!probe.violationDelayMs) {
    return;
  }
  throw new Error(
    `Observed log render delay ${probe.violationDelayMs}ms above ${LIVE_LOG_RENDER_DELAY_LIMIT_MS}ms for line: ${probe.violationLine}. Probe: ${formatLatencyProbe(
      probe
    )}`
  );
}

async function waitForLatencyProbe(
  page: Page,
  predicate: (probe: Awaited<ReturnType<typeof readLatencyProbe>>) => boolean,
  timeoutMs: number,
  failureLabel: string
) {
  const deadline = Date.now() + timeoutMs;
  let lastProbe = await readLatencyProbe(page);
  while (Date.now() < deadline) {
    await assertNoLatencyViolation(page);
    if (predicate(lastProbe)) {
      return lastProbe;
    }
    await page.waitForTimeout(200);
    lastProbe = await readLatencyProbe(page);
  }
  throw new Error(
    `${failureLabel} within ${timeoutMs}ms. Probe: ${formatLatencyProbe(lastProbe)}`
  );
}

async function waitForSuccessfulDeployment(page: Page) {
  const finalStatus = page.getByText(/Final status:/);
  const deadline = Date.now() + DEPLOYMENT_COMPLETION_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await assertNoLatencyViolation(page);
    const statusText = ((await finalStatus.textContent().catch(() => "")) || "").trim();
    if (statusText.includes("Succeeded")) {
      await assertNoLatencyViolation(page);
      return finalStatus;
    }
    if (statusText.includes("Failed") || statusText.includes("Canceled")) {
      throw new Error(`Deployment did not succeed: ${statusText}`);
    }
    await page.waitForTimeout(500);
  }
  throw new Error("Timed out waiting for a successful deployment.");
}

async function runDashboardDeployment(page: Page) {
  const consoleMessages: string[] = [];
  page.on("console", (message) => {
    consoleMessages.push(message.text());
  });
  page.on("dialog", async (dialog) => {
    if (
      dialog.type() === "prompt" &&
      /Master password for credentials\.kdbx/i.test(dialog.message())
    ) {
      await dialog.accept(MASTER_PASSWORD);
      return;
    }
    await dialog.dismiss();
  });

  await page.goto("/");

  await expect(page.locator("#workspace-switcher-slot > *")).toHaveCount(0);
  await expect(page.getByText("Workspaces")).toHaveCount(0);

  await page.getByRole("tab", { name: "Inventory" }).click();
  const workspaceId = await waitForWorkspaceId(page);
  expect(workspaceId).toMatch(/^[a-z0-9-]+$/);
  expect(observedWorkspaceIds.has(workspaceId)).toBeFalsy();
  observedWorkspaceIds.add(workspaceId);

  await page.getByRole("tab", { name: "Software" }).click();
  await switchToAppsScope(page);
  const roleSearch = page.getByRole("textbox", { name: "Search roles" });
  await roleSearch.fill("dashboard");

  const roleCard = page.locator(`[data-role-id="${ROLE_ID}"]`).first();
  await expect(roleCard).toBeVisible();
  await roleCard.getByRole("button", { name: "Enable", exact: true }).click();
  await expect(roleCard.getByText("Enabled")).toBeVisible();

  await page.getByRole("tab", { name: "Hardware" }).click();
  const modeToggle = page.getByRole("button", {
    name: "Toggle customer/expert mode",
  });
  await expect(modeToggle).toContainText("Customer");
  await modeToggle.click();
  await expect(page.getByText("Enable Expert mode?")).toBeVisible();
  await page.getByRole("button", { name: "Enable", exact: true }).click();
  await expect(modeToggle).toContainText("Expert");

  await page.getByRole("button", { name: "Add", exact: true }).click();
  const serverRow = page.locator(`[data-server-alias="${TARGET_ALIAS}"]`).first();
  await expect(serverRow).toBeVisible();
  await serverRow.getByRole("button", { name: "Detail" }).click();

  const detailCard = page.locator(`[data-server-detail="${TARGET_ALIAS}"]`);
  await expect(detailCard).toBeVisible();
  await detailCard.getByPlaceholder("localhost").fill("localhost");
  await detailCard.getByPlaceholder("localhost").press("Tab");
  await detailCard.getByPlaceholder("example.com").fill("ssh-password");
  await detailCard.getByPlaceholder("example.com").press("Tab");
  await detailCard.getByPlaceholder("22").fill("22");
  await detailCard.getByPlaceholder("22").press("Tab");
  const userInput = detailCard.getByPlaceholder("root");
  await userInput.fill("deploy");
  await expect(userInput).toHaveValue("deploy");
  await userInput.press("Tab");

  const passwordInput = detailCard.getByPlaceholder("Enter password");
  await passwordInput.fill("deploy");
  await expect(passwordInput).toHaveValue("deploy");
  await passwordInput.press("Tab");
  const confirmPassword = detailCard.getByPlaceholder("Confirm password");
  await confirmPassword.fill("deploy");
  await expect(confirmPassword).toHaveValue("deploy");
  await confirmPassword.press("Tab");

  await expect
    .poll(
      async () => (await detailCard.textContent()) || "",
      { timeout: 120_000 }
    )
    .toMatch(/Ping:\s*ok[\s\S]*SSH:\s*ok/);
  await page.getByRole("button", { name: "Close", exact: true }).click();

  await page.getByRole("tab", { name: "Inventory" }).click();
  const inventoryPanel = page.locator("[role='tabpanel'][data-panel-key='inventory']");
  await expect(inventoryPanel.getByText("inventory.yml", { exact: true })).toBeVisible({
    timeout: 120_000,
  });
  await expect(inventoryPanel.getByText("host_vars")).toBeVisible();
  await expect(
    inventoryPanel.getByText(`${TARGET_ALIAS}.yml`, { exact: true })
  ).toBeVisible();

  const groupVarsPath = `/api/workspaces/${workspaceId}/files/group_vars/all.yml`;
  const currentGroupVars = await page.request.get(groupVarsPath);
  expect(currentGroupVars.ok()).toBeTruthy();
  const currentContent = (await currentGroupVars.json()).content || "";
  const e2eOverrides = [
    "",
    "users:",
    "  administrator:",
    `    authorized_keys: ["${ADMINISTRATOR_AUTHORIZED_KEY}"]`,
    "",
    "applications:",
    "  web-app-dashboard:",
    "    compose:",
    "      services:",
    "        oidc:",
    "          enabled: false",
    "          shared: false",
    "        simpleicons:",
    "          enabled: false",
    "          shared: false",
    "        logout:",
    "          enabled: false",
    "        matomo:",
    "          enabled: false",
    "          shared: false",
    "        dashboard:",
    "          enabled: true",
    "  web-svc-logout:",
    "    compose:",
    "      services:",
    "        matomo:",
    "          enabled: false",
    "          shared: false",
    "",
  ].join("\n");
  const mergedGroupVars = currentContent + (currentContent.endsWith("\n") ? "" : "\n") + e2eOverrides;
  const putGroupVars = await page.request.put(groupVarsPath, {
    data: { content: mergedGroupVars },
    headers: await csrfHeaders(page),
  });
  if (!putGroupVars.ok()) {
    const body = await putGroupVars.text();
    throw new Error(`PUT ${groupVarsPath} failed: ${putGroupVars.status()} ${body}`);
  }

  await inventoryPanel.getByRole("button", { name: "Credentials" }).click();
  const appCredentialsButton = page.getByRole("button", { name: "App credentials" });
  await expect(appCredentialsButton).toBeEnabled({ timeout: 120_000 });
  await appCredentialsButton.click();
  await expect(page.getByRole("heading", { name: "App credentials" })).toBeVisible();
  await page.getByRole("button", { name: "Create", exact: true }).click();

  await expect(page.getByPlaceholder("Repeat master password")).toBeVisible();
  await page.getByPlaceholder("Enter master password").fill(MASTER_PASSWORD);
  await page.getByPlaceholder("Repeat master password").fill(MASTER_PASSWORD);
  await page.getByRole("button", { name: "Continue", exact: true }).click();

  await expect(page.getByText(/Credentials generated/i)).toBeVisible({
    timeout: 120_000,
  });
  await expect(
    inventoryPanel.getByText("credentials.kdbx", { exact: true })
  ).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("heading", { name: "App credentials" })).toHaveCount(0);

  await page.getByRole("tab", { name: "Setup" }).click();
  const deployRow = page.locator(`[data-server-alias="${TARGET_ALIAS}"]`).first();
  await expect(deployRow).toBeVisible();
  await expect(deployRow.getByRole("checkbox", { name: `Select ${TARGET_ALIAS}` })).toBeEnabled();
  await expect(
    deployRow.getByRole("button", { name: "Status: Deployed" })
  ).toHaveCount(0);
  await deployRow.getByRole("checkbox", { name: `Select ${TARGET_ALIAS}` }).check();

  const deployButton = page.getByRole("button", { name: "Deploy", exact: true });
  await deployButton.click();
  await expect(page.locator(".xterm")).toBeVisible({ timeout: 3_000 });
  await waitForLatencyProbe(
    page,
    (probe) => probe.receivedLineCount > 0,
    LIVE_LOG_RENDER_DELAY_LIMIT_MS,
    "Live terminal did not receive any log lines"
  );
  await waitForLatencyProbe(
    page,
    (probe) => probe.observedCount > 0,
    LIVE_LOG_RENDER_DELAY_LIMIT_MS,
    "Live terminal did not render any timestamped log lines"
  );

  const finalStatus = await waitForSuccessfulDeployment(page);
  await expect(finalStatus).toContainText("exit 0");

  const latencyProbe = await readLatencyProbe(page);
  expect(latencyProbe.observedCount).toBeGreaterThan(0);
  expect(latencyProbe.sampleCount).toBeGreaterThan(0);
  expect(latencyProbe.maxDelayMs).toBeLessThanOrEqual(
    LIVE_LOG_RENDER_DELAY_LIMIT_MS
  );

  await assertDashboardReachable();

  expect(consoleMessages.join("\n")).not.toContain(MASTER_PASSWORD);
  await expect(page.locator("body")).not.toContainText(MASTER_PASSWORD);
}

test.describe.configure({ mode: "serial" });

test("deploys web-app-dashboard through the real local stack on a fresh anonymous workspace", async ({
  page,
}) => {
  await runDashboardDeployment(page);
});

test("re-runs the dashboard deployment flow with a new anonymous workspace", async ({
  page,
}) => {
  await runDashboardDeployment(page);
});
