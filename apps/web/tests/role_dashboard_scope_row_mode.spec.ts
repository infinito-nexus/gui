import { expect, test, type Page, type Route } from "@playwright/test";

const roles = [
  {
    id: "calendar",
    display_name: "Calendar App",
    status: "stable",
    description: "Calendar and scheduling",
    deployment_targets: ["server"],
    categories: ["productivity"],
    galaxy_tags: ["calendar"],
  },
  {
    id: "notes",
    display_name: "Notes App",
    status: "beta",
    description: "Shared notes",
    deployment_targets: ["server"],
    categories: ["productivity"],
    galaxy_tags: ["notes"],
  },
];

const bundles = [
  {
    id: "community-hub",
    slug: "community-hub",
    deploy_target: "server",
    title: "Community Hub",
    description: "Community starter bundle",
    role_ids: ["calendar", "notes"],
    categories: ["communication"],
    tags: ["community"],
  },
];

async function fulfillJson(route: Route, payload: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(payload),
  });
}

async function openSoftwareTabIfNeeded(page: Page) {
  const softwareTab = page.getByRole("tab", { name: "Software" });
  if ((await softwareTab.count()) > 0) {
    await softwareTab.first().click();
  }
}

async function selectViewMode(page: Page, mode: "Row" | "Column") {
  await page.locator("button[aria-haspopup='menu']").first().click();
  const menu = page.locator("[role='menu']").first();
  await expect(menu).toBeVisible();
  await menu.getByRole("button", { name: mode, exact: true }).click();
}

test.beforeEach(async ({ page }) => {
  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const method = req.method();
    const url = new URL(req.url());
    const path = url.pathname;

    if (path === "/api/roles" && method === "GET") {
      return fulfillJson(route, roles);
    }
    if (path === "/api/bundles" && method === "GET") {
      return fulfillJson(route, bundles);
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
        workspace_id: "abc123def456",
        created_at: "2026-03-13T00:00:00Z",
      });
    }

    if (path === "/api/providers/primary-domain" && method === "GET") {
      return fulfillJson(route, { ok: true, primary_domain: "example.local" });
    }
    if (path === "/api/providers/offers" && method === "GET") {
      return fulfillJson(route, []);
    }
    if (path === "/api/providers/domain-availability" && method === "GET") {
      return fulfillJson(route, { available: true, note: "available" });
    }
    if (path === "/api/providers/order/server" && method === "POST") {
      return fulfillJson(route, { ok: true });
    }

    return fulfillJson(route, { ok: true });
  });
});

test("scope toggle and row animation controls stay stable across rerenders", async ({
  page,
}) => {
  await page.goto("/?sw_scope=bundles");
  await openSoftwareTabIfNeeded(page);

  const scopeToggle = page.getByRole("button", { name: "Toggle apps and bundles" });

  await expect(scopeToggle).toContainText("Bundles");
  await expect(page.getByRole("textbox", { name: "Search bundles" })).toBeVisible();

  await selectViewMode(page, "Row");
  await expect(page.getByRole("button", { name: "Skip backward" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Stop animation" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Skip forward" })).toBeVisible();
  await expect(page.getByText("Community Hub", { exact: true })).toBeVisible();

  await scopeToggle.click();
  await expect(scopeToggle).toContainText("Apps");
  await expect(page.getByRole("textbox", { name: "Search roles" })).toBeVisible();
  await expect(page.getByText("Calendar App", { exact: true })).toBeVisible();
  await expect
    .poll(() => new URL(page.url()).searchParams.get("sw_scope"))
    .toBe("apps");

  await page.getByRole("textbox", { name: "Search roles" }).fill("calendar");
  await expect
    .poll(() => new URL(page.url()).searchParams.get("sw_scope"))
    .toBe("apps");
  await expect(scopeToggle).toContainText("Apps");
  await expect(page.getByRole("button", { name: "Stop animation" })).toBeVisible();

  await page.getByRole("button", { name: "Stop animation" }).click();
  await expect(page.getByRole("button", { name: "Start animation" })).toBeVisible();
  await page.getByRole("button", { name: "Start animation" }).click();
  await expect(page.getByRole("button", { name: "Stop animation" })).toBeVisible();

  await scopeToggle.click();
  await expect(scopeToggle).toContainText("Bundles");
  await expect(page.getByText("Community Hub", { exact: true })).toBeVisible();
  await expect
    .poll(() => new URL(page.url()).searchParams.get("sw_scope"))
    .toBe("bundles");

  await page.getByRole("textbox", { name: "Search bundles" }).fill("community");
  await expect
    .poll(() => new URL(page.url()).searchParams.get("sw_scope"))
    .toBe("bundles");
  await expect(scopeToggle).toContainText("Bundles");
  await expect(page.getByRole("button", { name: "Stop animation" })).toBeVisible();
});
