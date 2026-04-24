import { expect, test, type Route } from "@playwright/test";

async function fulfillJson(route: Route, payload: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(payload),
  });
}

test("client fetch bootstrap mirrors the csrf cookie into X-CSRF for same-origin writes", async ({
  page,
}) => {
  let observedHeader = "";

  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;

    if (path === "/api/roles" && req.method() === "GET") {
      return fulfillJson(route, []);
    }
    if (path === "/api/bundles" && req.method() === "GET") {
      return fulfillJson(route, []);
    }
    if (path === "/api/workspaces" && req.method() === "GET") {
      return fulfillJson(route, {
        authenticated: false,
        user_id: null,
        workspaces: [],
      });
    }
    if (path === "/api/workspaces" && req.method() === "POST") {
      return fulfillJson(route, {
        workspace_id: "csrf-workspace-1",
        created_at: "2026-04-21T10:00:00Z",
      });
    }
    if (
      path === "/api/workspaces/csrf-workspace-1/files" &&
      req.method() === "GET"
    ) {
      return fulfillJson(route, { files: [] });
    }
    if (
      path === "/api/workspaces/csrf-workspace-1/runtime-settings" &&
      req.method() === "GET"
    ) {
      return fulfillJson(route, { keepassxc_cli_path: "keepassxc-cli" });
    }
    if (
      path === "/api/workspaces/csrf-workspace-1/server-requirements" &&
      req.method() === "GET"
    ) {
      return fulfillJson(route, []);
    }
    if (path === "/api/csrf-echo" && req.method() === "POST") {
      observedHeader = req.headers()["x-csrf"] || "";
      return fulfillJson(route, { ok: true });
    }
    return fulfillJson(route, { ok: true });
  });

  await page.goto("/");
  await expect
    .poll(() =>
      page.evaluate(() =>
        Boolean(
          Reflect.get(window as typeof window & Record<string, unknown>, "__infinitoCsrfBootstrapReady"),
        ),
      ),
    )
    .toBe(true);
  await page.context().addCookies([
    {
      name: "csrf",
      value: "csrf-token-123",
      url: page.url(),
      sameSite: "Strict",
    },
  ]);
  await expect.poll(() => page.evaluate(() => document.cookie)).toContain(
    "csrf=csrf-token-123"
  );
  await page.evaluate(async () => {
    const response = await fetch("/api/csrf-echo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: true }),
    });
    if (!response.ok) {
      throw new Error(`expected ok response, received ${response.status}`);
    }
  });

  await expect.poll(() => observedHeader).toBe("csrf-token-123");
});
