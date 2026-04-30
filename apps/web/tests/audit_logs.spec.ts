import { expect, test, type Page, type Route } from "@playwright/test";

type AuditConfig = {
  workspace_id: string;
  retention_days: number;
  mode: "all" | "writes-only" | "auth-only" | "deployment-only" | "errors-only";
  exclude_health_endpoints: boolean;
};

type AuditEntry = {
  id: number;
  timestamp: string;
  workspace_id: string;
  user: string;
  method: string;
  path: string;
  status: number;
  duration_ms: number;
  ip: string;
  request_id: string | null;
  user_agent: string | null;
};

type MockAuditState = {
  config: AuditConfig;
  entries: AuditEntry[];
  lastListQuery: URLSearchParams | null;
  lastExportQuery: URLSearchParams | null;
  lastConfigPayload: Record<string, unknown> | null;
  seenApiPaths: string[];
};

const WORKSPACE_ID = "audit-workspace-123";

async function fulfillJson(route: Route, payload: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(payload),
  });
}

async function mockAuditApi(page: Page): Promise<MockAuditState> {
  const state: MockAuditState = {
    config: {
      workspace_id: WORKSPACE_ID,
      retention_days: 180,
      mode: "all",
      exclude_health_endpoints: false,
    },
    entries: [
      {
        id: 1,
        timestamp: "2026-04-21T10:15:00Z",
        workspace_id: WORKSPACE_ID,
        user: "alice",
        method: "POST",
        path: "/api/deployments",
        status: 500,
        duration_ms: 120,
        ip: "203.0.113.7",
        request_id: "req-1",
        user_agent: "playwright-audit",
      },
      {
        id: 2,
        timestamp: "2026-04-21T10:20:00Z",
        workspace_id: WORKSPACE_ID,
        user: "bob",
        method: "GET",
        path: "/api/workspaces/audit-workspace-123/logs/config",
        status: 200,
        duration_ms: 12,
        ip: "198.51.100.8",
        request_id: "req-2",
        user_agent: "playwright-audit",
      },
    ],
    lastListQuery: null,
    lastExportQuery: null,
    lastConfigPayload: null,
    seenApiPaths: [],
  };

  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const method = req.method();
    const url = new URL(req.url());
    const path = url.pathname;
    state.seenApiPaths.push(`${method} ${path}`);

    if (path === "/api/roles" && method === "GET") {
      return fulfillJson(route, []);
    }
    if (path === "/api/bundles" && method === "GET") {
      return fulfillJson(route, []);
    }
    if (path === "/api/providers/primary-domain" && method === "GET") {
      return fulfillJson(route, { ok: true, primary_domain: "example.local" });
    }
    if (path === "/api/providers/domain-availability" && method === "GET") {
      return fulfillJson(route, { available: true, note: "available" });
    }
    if (path === "/api/providers/offers" && method === "GET") {
      return fulfillJson(route, []);
    }
    if (path === "/api/providers/order/server" && method === "POST") {
      return fulfillJson(route, { ok: true });
    }

    if (path === "/api/workspaces" && method === "GET") {
      return fulfillJson(route, {
        authenticated: false,
        user_id: null,
        workspaces: [],
      });
    }
    if (path === "/api/workspaces" && method === "POST") {
      return fulfillJson(route, {
        workspace_id: WORKSPACE_ID,
        created_at: "2026-04-21T10:00:00Z",
      });
    }
    if (/^\/api\/workspaces\/[^/]+\/files\/?$/.test(path) && method === "GET") {
      return fulfillJson(route, { files: [] });
    }
    if (
      /^\/api\/workspaces\/[^/]+\/runtime-settings\/?$/.test(path) &&
      method === "GET"
    ) {
      return fulfillJson(route, { keepassxc_cli_path: "keepassxc-cli" });
    }
    if (
      /^\/api\/workspaces\/[^/]+\/server-requirements\/?$/.test(path) &&
      method === "GET"
    ) {
      return fulfillJson(route, []);
    }
    if (
      /^\/api\/workspaces\/[^/]+\/generate-inventory\/?$/.test(path) &&
      method === "POST"
    ) {
      return fulfillJson(route, {
        workspace_id: WORKSPACE_ID,
        inventory_path: "inventory.yml",
        files: [],
        warnings: [],
      });
    }

    if (
      /^\/api\/workspaces\/[^/]+\/logs\/config\/?$/.test(path) &&
      method === "GET"
    ) {
      return fulfillJson(route, state.config);
    }
    if (
      /^\/api\/workspaces\/[^/]+\/logs\/config\/?$/.test(path) &&
      method === "PUT"
    ) {
      const payload = JSON.parse(req.postData() || "{}") as Record<string, unknown>;
      state.lastConfigPayload = payload;
      state.config = {
        workspace_id: WORKSPACE_ID,
        retention_days: Number(payload.retention_days || 180),
        mode: String(payload.mode || "all") as AuditConfig["mode"],
        exclude_health_endpoints: Boolean(payload.exclude_health_endpoints),
      };
      return fulfillJson(route, state.config);
    }

    if (path === `/api/workspaces/${WORKSPACE_ID}/logs/entries` && method === "GET") {
      state.lastListQuery = url.searchParams;
      const user = url.searchParams.get("user");
      const ip = url.searchParams.get("ip");
      const q = url.searchParams.get("q");
      const status = url.searchParams.get("status");
      const httpMethod = url.searchParams.get("method");

      const filtered = state.entries.filter((entry) => {
        if (user && entry.user !== user) {
          return false;
        }
        if (ip && entry.ip !== ip) {
          return false;
        }
        if (status && String(entry.status) !== status) {
          return false;
        }
        if (httpMethod && entry.method !== httpMethod) {
          return false;
        }
        if (
          q &&
          ![entry.path, entry.user, entry.request_id || "", entry.user_agent || ""]
            .join(" ")
            .toLowerCase()
            .includes(q.toLowerCase())
        ) {
          return false;
        }
        return true;
      });

      return fulfillJson(route, {
        entries: filtered,
        page: Number(url.searchParams.get("page") || 1),
        page_size: Number(url.searchParams.get("page_size") || 50),
        total: filtered.length,
      });
    }
    if (
      /^\/api\/workspaces\/[^/]+\/logs\/entries\/?$/.test(path) &&
      method === "GET"
    ) {
      state.lastListQuery = url.searchParams;
      const user = url.searchParams.get("user");
      const ip = url.searchParams.get("ip");
      const q = url.searchParams.get("q");
      const status = url.searchParams.get("status");
      const httpMethod = url.searchParams.get("method");

      const filtered = state.entries.filter((entry) => {
        if (user && entry.user !== user) {
          return false;
        }
        if (ip && entry.ip !== ip) {
          return false;
        }
        if (status && String(entry.status) !== status) {
          return false;
        }
        if (httpMethod && entry.method !== httpMethod) {
          return false;
        }
        if (
          q &&
          ![entry.path, entry.user, entry.request_id || "", entry.user_agent || ""]
            .join(" ")
            .toLowerCase()
            .includes(q.toLowerCase())
        ) {
          return false;
        }
        return true;
      });

      return fulfillJson(route, {
        entries: filtered,
        page: Number(url.searchParams.get("page") || 1),
        page_size: Number(url.searchParams.get("page_size") || 50),
        total: filtered.length,
      });
    }

    if (
      /^\/api\/workspaces\/[^/]+\/logs\/entries\/export\/?$/.test(path) &&
      method === "GET"
    ) {
      state.lastExportQuery = url.searchParams;
      const isZip = url.searchParams.get("zip") === "true";
      const format = url.searchParams.get("format") || "jsonl";
      await route.fulfill({
        status: 200,
        contentType: isZip ? "application/zip" : "application/octet-stream",
        headers: {
          "Content-Disposition": `attachment; filename="audit-log.${isZip ? "zip" : format}"`,
        },
        body: isZip ? "zip-export" : "export-body",
      });
      return;
    }

    return fulfillJson(route, { ok: true });
  });

  return state;
}

test("audit logs panel supports filters, config updates, and export", async ({ page }) => {
  const state = await mockAuditApi(page);
  page.on("pageerror", (error) => {
    throw error;
  });
  const expectedFrom = new Date("2026-04-21T10:00").toISOString();
  const expectedTo = new Date("2026-04-21T11:00").toISOString();

  // Audit logs now live under the Settings panel as an auth-gated
  // sub-tab. The legacy `?ui_panel=audit` deep link is preserved by
  // useDeploymentWorkspaceEffects (auto-selecting the audit sub-tab),
  // but AccountPanel only renders that sub-tab when the localStorage
  // session is set. Seed the spec's session before navigation so the
  // existing assertions still find the panel without an extra
  // login-modal step.
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("infinito.user_id", "audit-spec-user");
    } catch {
      /* ignore */
    }
  });

  await page.goto(`/?ui_panel=audit&workspace=${WORKSPACE_ID}`);

  const panel = page.getByTestId("audit-logs-panel");
  await expect(panel).toBeVisible({ timeout: 10_000 });
  await expect(panel.getByText("Structured request events for this workspace")).toBeVisible();
  try {
    await expect.poll(() => state.lastListQuery?.toString() || "", {
      timeout: 10_000,
    }).not.toBe("");
  } catch (error) {
    const panelText = (await panel.textContent()) || "";
    throw new Error(
      `Audit entries never loaded. Seen API paths: ${state.seenApiPaths.join(", ")}. Panel text: ${panelText}`,
      { cause: error }
    );
  }
  await expect(panel.getByText("/api/deployments")).toBeVisible();

  await panel.locator("#audit-from").fill("2026-04-21T10:00");
  await panel.locator("#audit-to").fill("2026-04-21T11:00");
  await panel.locator("#audit-user").fill("alice");
  await panel.locator("#audit-ip").fill("203.0.113.7");
  await panel.locator("#audit-status").fill("500");
  await panel.locator("#audit-method").selectOption("POST");
  await panel.locator("#audit-search").fill("deploy");

  await expect.poll(() => state.lastListQuery?.get("user") || "").toBe("alice");
  await expect.poll(() => state.lastListQuery?.get("ip") || "").toBe("203.0.113.7");
  await expect.poll(() => state.lastListQuery?.get("status") || "").toBe("500");
  await expect.poll(() => state.lastListQuery?.get("method") || "").toBe("POST");
  await expect.poll(() => state.lastListQuery?.get("q") || "").toBe("deploy");
  await expect.poll(() => state.lastListQuery?.get("from") || "").toBe(expectedFrom);
  await expect.poll(() => state.lastListQuery?.get("to") || "").toBe(expectedTo);
  await expect(panel.getByText("1 shown of 1 total")).toBeVisible();

  await panel.locator("#audit-retention").fill("90");
  await panel.locator("#audit-mode").selectOption("errors-only");
  await panel.getByLabel("Exclude health endpoints from future audit events").check();
  await panel.getByRole("button", { name: "Save Config" }).click();

  await expect.poll(() => state.lastConfigPayload?.mode || "").toBe("errors-only");
  await expect.poll(() => String(state.lastConfigPayload?.retention_days || "")).toBe("90");
  await expect
    .poll(() => String(state.lastConfigPayload?.exclude_health_endpoints || ""))
    .toBe("true");
  await expect(panel.getByText("Current mode:")).toContainText("errors-only");
  await expect(panel.getByText("Retention:")).toContainText("90 days");

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export JSONL" }).click();
  const exportDownload = await download;

  expect(exportDownload.suggestedFilename()).toBe("audit-log.jsonl");
  await expect.poll(() => state.lastExportQuery?.get("format") || "").toBe("jsonl");
  await expect.poll(() => state.lastExportQuery?.get("user") || "").toBe("alice");
  await expect.poll(() => state.lastExportQuery?.get("ip") || "").toBe("203.0.113.7");
  await expect.poll(() => state.lastExportQuery?.get("status") || "").toBe("500");
  await expect.poll(() => state.lastExportQuery?.get("method") || "").toBe("POST");
  await expect.poll(() => state.lastExportQuery?.get("q") || "").toBe("deploy");
  await expect.poll(() => state.lastExportQuery?.get("from") || "").toBe(expectedFrom);
  await expect.poll(() => state.lastExportQuery?.get("to") || "").toBe(expectedTo);
});
