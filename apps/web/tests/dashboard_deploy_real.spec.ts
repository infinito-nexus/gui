import { execFileSync } from "node:child_process";

import { expect, test, type Page } from "@playwright/test";

const MASTER_PASSWORD = "vault-pass-014";
const ROLE_ID = "web-app-dashboard";
const TARGET_ALIAS = "device";
const DASHBOARD_HTTP_URL = "http://127.0.0.1:8029/";
const DEPLOYMENT_COMPLETION_TIMEOUT_MS = 40 * 60_000;
const ADMINISTRATOR_AUTHORIZED_KEY =
  "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKKBS2UWGKi9IRz2b+JjkAWGiAkFDrxnnQXiueLQTKDz infinito-test";

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

async function assertDashboardReachable() {
  await expect
    .poll(
      () => {
        try {
          return runCompose(
            "exec",
            "-T",
            "ssh-password",
            "bash",
            "-lc",
            `curl -fsS -o /dev/null -w '%{http_code}' ${DASHBOARD_HTTP_URL}`
          );
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

test("deploys web-app-dashboard through the real local stack", async ({ page }) => {
  const consoleMessages: string[] = [];
  page.on("console", (message) => {
    consoleMessages.push(message.text());
  });

  await page.goto("/");

  await expect(page.locator("#workspace-switcher-slot > *")).toHaveCount(0);
  await expect(page.getByText("Workspaces")).toHaveCount(0);

  await page.getByRole("tab", { name: "Inventory" }).click();
  const workspaceId = await waitForWorkspaceId(page);
  expect(workspaceId).toMatch(/^[a-z0-9-]+$/);

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

  await page.getByRole("button", { name: "Users" }).click();
  await page.getByRole("button", { name: "Overview" }).click();
  await expect(page.getByText("Users overview from")).toBeVisible();
  await page.getByRole("button", { name: "New", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Add user" })).toBeVisible();
  await page.getByLabel("Username* (a-z0-9)").fill("administrator");
  await page.getByLabel("Firstname*").fill("Administrator");
  await page.getByLabel("Lastname*").fill("Dashboard");
  await page
    .getByLabel("Authorized keys (optional, one per line)")
    .fill(ADMINISTRATOR_AUTHORIZED_KEY);
  await page.getByRole("button", { name: "Add user", exact: true }).click();
  await expect(
    page.getByText("User 'administrator' added. Save to persist changes.")
  ).toBeVisible();
  await page.getByRole("button", { name: "Save users", exact: true }).click();
  await expect(
    page.getByText("Saved 1 user(s) to group_vars/all.yml.")
  ).toBeVisible({ timeout: 120_000 });
  await page.getByRole("button", { name: "Close overview", exact: true }).click();
  await expect(page.getByText("Users overview from")).toHaveCount(0);
  await expect(inventoryPanel.getByText("group_vars")).toBeVisible();
  await expect(inventoryPanel.getByText("all.yml", { exact: true })).toBeVisible();

  const groupVarsPath = `/api/workspaces/${workspaceId}/files/group_vars/all.yml`;
  const currentGroupVars = await page.request.get(groupVarsPath);
  expect(currentGroupVars.ok()).toBeTruthy();
  const currentContent = (await currentGroupVars.json()).content || "";
  const e2eOverrides = [
    "",
    "OIDC:",
    "  CLIENT:",
    "    SECRET: '{{ \"e2e-test-oidc-client-secret-32chars-dummy\" }}'",
    "",
  ].join("\n");
  const mergedGroupVars = currentContent + (currentContent.endsWith("\n") ? "" : "\n") + e2eOverrides;
  const putGroupVars = await page.request.put(groupVarsPath, {
    data: { content: mergedGroupVars },
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
  await expect
    .poll(
      async () => {
        const text = (await page.locator(".xterm-rows").textContent()) || "";
        return text.trim().length;
      },
      { timeout: 3_000 }
    )
    .toBeGreaterThan(0);

  const finalStatus = page.getByText(/Final status:/);
  await expect(finalStatus).toBeVisible({ timeout: DEPLOYMENT_COMPLETION_TIMEOUT_MS });
  const firstStatusText = (await finalStatus.textContent()) || "";
  if (!firstStatusText.includes("Succeeded")) {
    await expect(deployButton).toBeEnabled({ timeout: 60_000 });
    await deployButton.click();
    await expect(finalStatus).toBeVisible({ timeout: DEPLOYMENT_COMPLETION_TIMEOUT_MS });
    await expect(finalStatus).toContainText("Succeeded", {
      timeout: DEPLOYMENT_COMPLETION_TIMEOUT_MS,
    });
  } else {
    await expect(finalStatus).toContainText("Succeeded");
  }
  await expect(finalStatus).toContainText("exit 0");

  await assertDashboardReachable();

  expect(consoleMessages.join("\n")).not.toContain(MASTER_PASSWORD);
  await expect(page.locator("body")).not.toContainText(MASTER_PASSWORD);
});
