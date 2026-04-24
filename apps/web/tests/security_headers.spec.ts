import { expect, test, type Page, type Route } from "@playwright/test";

async function fulfillJson(route: Route, payload: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(payload),
  });
}

async function stubDashboardBoot(page: Page) {
  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;

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
        workspaces: [
          {
            workspace_id: "security-workspace-1",
            created_at: "2026-04-22T08:00:00Z",
          },
        ],
      });
    }
    if (
      path === "/api/workspaces/security-workspace-1/files" &&
      req.method() === "GET"
    ) {
      return fulfillJson(route, { files: [] });
    }
    if (
      path === "/api/workspaces/security-workspace-1/runtime-settings" &&
      req.method() === "GET"
    ) {
      return fulfillJson(route, { keepassxc_cli_path: "keepassxc-cli" });
    }
    if (
      path === "/api/workspaces/security-workspace-1/server-requirements" &&
      req.method() === "GET"
    ) {
      return fulfillJson(route, []);
    }
    return fulfillJson(route, { ok: true });
  });
}

test("web middleware sets a nonce-based CSP and rotates the nonce per request", async ({
  browser,
  baseURL,
}) => {
  const contextA = await browser.newContext({ baseURL });
  const pageA = await contextA.newPage();
  await stubDashboardBoot(pageA);
  const responseA = await pageA.goto("/");
  expect(responseA).not.toBeNull();
  const cspA = responseA?.headers()["content-security-policy"] || "";
  const nonceA = responseA?.headers()["x-nonce"] || "";
  expect(cspA).toContain("default-src 'self'");
  expect(cspA).toContain("script-src 'self'");
  expect(cspA).toContain(`'nonce-${nonceA}'`);
  expect(cspA).toContain("frame-src https://www.youtube.com https://www.youtube-nocookie.com");
  expect(cspA).toContain("connect-src 'self'");
  expect(cspA).not.toContain("fontawesome");
  expect(cspA).not.toContain("simpleicons");
  expect(cspA).not.toContain("cdn.");
  const bootstrapNonceA = await pageA
    .locator("script[data-infinito-csp-bootstrap]")
    .evaluate((element) => (element as HTMLScriptElement).nonce);
  expect(bootstrapNonceA).toBe(nonceA);
  await contextA.close();

  const contextB = await browser.newContext({ baseURL });
  const pageB = await contextB.newPage();
  await stubDashboardBoot(pageB);
  const responseB = await pageB.goto("/");
  expect(responseB).not.toBeNull();
  const nonceB = responseB?.headers()["x-nonce"] || "";
  expect(nonceB).not.toBe("");
  expect(nonceB).not.toBe(nonceA);
  const bootstrapNonceB = await pageB
    .locator("script[data-infinito-csp-bootstrap]")
    .evaluate((element) => (element as HTMLScriptElement).nonce);
  expect(bootstrapNonceB).toBe(nonceB);
  await contextB.close();
});
