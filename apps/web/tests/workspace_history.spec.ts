import { expect, test, type Page, type Route } from "@playwright/test";

type MockFileEntry = {
  path: string;
  is_dir: boolean;
  size?: number;
  modified_at?: string;
};

type MockState = {
  workspaceId: string;
  files: MockFileEntry[];
  fileContents: Record<string, string>;
  saveRequests: number;
  restoreWorkspaceRequests: number;
  restorePathRequests: number;
  historyPathQueries: string[];
  rawToken: string;
  commitSha: string;
};

const FIXED_ISO = "2026-02-20T12:00:00Z";

function decodeWorkspacePath(pathname: string): string {
  const marker = "/files/";
  const idx = pathname.indexOf(marker);
  if (idx < 0) return "";
  return decodeURIComponent(pathname.slice(idx + marker.length));
}

function upsertFile(state: MockState, path: string, content: string): void {
  if (!state.files.some((entry) => entry.path === path)) {
    state.files.push({
      path,
      is_dir: false,
      size: content.length,
      modified_at: FIXED_ISO,
    });
    const dir = path.split("/").slice(0, -1).join("/");
    if (dir && !state.files.some((entry) => entry.path === dir)) {
      state.files.push({
        path: dir,
        is_dir: true,
        modified_at: FIXED_ISO,
      });
    }
    state.files.sort((a, b) => a.path.localeCompare(b.path));
  } else {
    state.files = state.files.map((entry) =>
      entry.path === path
        ? {
            ...entry,
            size: content.length,
            modified_at: FIXED_ISO,
          }
        : entry
    );
  }
  state.fileContents[path] = content;
}

async function fulfillJson(route: Route, status: number, payload: unknown) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(payload),
  });
}

async function mockWorkspaceApi(page: Page): Promise<MockState> {
  const state: MockState = {
    workspaceId: "abc123def456",
    files: [
      { path: "group_vars", is_dir: true, modified_at: FIXED_ISO },
      { path: "host_vars", is_dir: true, modified_at: FIXED_ISO },
      { path: "secrets", is_dir: true, modified_at: FIXED_ISO },
      { path: "group_vars/all.yml", is_dir: false, size: 18, modified_at: FIXED_ISO },
    ],
    fileContents: {
      "group_vars/all.yml": "name: demo\nvalue: 1\n",
    },
    saveRequests: 0,
    restoreWorkspaceRequests: 0,
    restorePathRequests: 0,
    historyPathQueries: [],
    rawToken: "abcDEF0123456789ghijKLMN",
    commitSha: "2db0dc2f8441f4f4f9b44baccb704f96c5fc8e87",
  };

  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const method = req.method();
    const url = new URL(req.url());
    const path = url.pathname;

    if (path === "/api/roles" && method === "GET") {
      return fulfillJson(route, 200, []);
    }

    if (path === "/api/providers/primary-domain") {
      return fulfillJson(route, 200, { primary_domain: "example.local", ok: true });
    }
    if (path === "/api/providers/domain-availability" && method === "GET") {
      return fulfillJson(route, 200, { available: true, note: "available" });
    }
    if (path === "/api/providers/offers" && method === "GET") {
      return fulfillJson(route, 200, []);
    }
    if (path === "/api/providers/order/server" && method === "POST") {
      return fulfillJson(route, 200, { ok: true });
    }

    if (path === "/api/workspaces" && method === "GET") {
      return fulfillJson(route, 200, {
        authenticated: false,
        user_id: null,
        workspaces: [],
      });
    }
    if (path === "/api/workspaces" && method === "POST") {
      return fulfillJson(route, 200, {
        workspace_id: state.workspaceId,
        created_at: FIXED_ISO,
      });
    }
    if (path === `/api/workspaces/${state.workspaceId}` && method === "DELETE") {
      return fulfillJson(route, 200, { ok: true });
    }
    if (path === `/api/workspaces/${state.workspaceId}/files` && method === "GET") {
      return fulfillJson(route, 200, { files: state.files });
    }

    if (path.startsWith(`/api/workspaces/${state.workspaceId}/files/`)) {
      const workspacePath = decodeWorkspacePath(path);

      if (method === "GET") {
        if (Object.prototype.hasOwnProperty.call(state.fileContents, workspacePath)) {
          return fulfillJson(route, 200, {
            path: workspacePath,
            content: state.fileContents[workspacePath],
          });
        }
        return fulfillJson(route, 404, { detail: "file not found" });
      }

      if (method === "PUT") {
        const body = JSON.parse(req.postData() || "{}");
        const content = String(body?.content ?? "");
        state.saveRequests += 1;
        upsertFile(state, workspacePath, content);
        return fulfillJson(route, 200, { path: workspacePath, content });
      }

      if (method === "DELETE") {
        delete state.fileContents[workspacePath];
        state.files = state.files.filter((entry) => entry.path !== workspacePath);
        return fulfillJson(route, 200, { ok: true });
      }
    }

    if (
      path.startsWith(`/api/workspaces/${state.workspaceId}/files/`) &&
      path.endsWith("/rename") &&
      method === "POST"
    ) {
      const body = JSON.parse(req.postData() || "{}");
      return fulfillJson(route, 200, { path: String(body?.new_path || "") });
    }
    if (
      path.startsWith(`/api/workspaces/${state.workspaceId}/files/`) &&
      path.endsWith("/mkdir") &&
      method === "POST"
    ) {
      const rel = decodeWorkspacePath(path.replace(/\/mkdir$/, ""));
      state.files.push({ path: rel, is_dir: true, modified_at: FIXED_ISO });
      state.files.sort((a, b) => a.path.localeCompare(b.path));
      return fulfillJson(route, 200, { path: rel });
    }

    if (path === `/api/workspaces/${state.workspaceId}/history` && method === "GET") {
      const scope = url.searchParams.get("path");
      if (scope) state.historyPathQueries.push(scope);
      return fulfillJson(route, 200, {
        commits: [
          {
            sha: state.commitSha,
            created_at: FIXED_ISO,
            summary: "edit: group_vars/all.yml",
            files: [
              {
                status: "M",
                path: "group_vars/all.yml",
                old_path: null,
              },
            ],
          },
        ],
      });
    }
    if (
      path === `/api/workspaces/${state.workspaceId}/history/${state.commitSha}` &&
      method === "GET"
    ) {
      return fulfillJson(route, 200, {
        sha: state.commitSha,
        created_at: FIXED_ISO,
        summary: "edit: group_vars/all.yml",
        files: [{ status: "M", path: "group_vars/all.yml", old_path: null }],
      });
    }
    if (
      path === `/api/workspaces/${state.workspaceId}/history/${state.commitSha}/diff` &&
      method === "GET"
    ) {
      return fulfillJson(route, 200, {
        sha: state.commitSha,
        path: url.searchParams.get("path"),
        against_current: url.searchParams.get("against_current") === "true",
        files: [{ status: "M", path: "group_vars/all.yml", old_path: null }],
        diff: "@@ -1 +1 @@\n-value: ********\n+value: ********\n",
      });
    }
    if (
      path === `/api/workspaces/${state.workspaceId}/history/${state.commitSha}/restore` &&
      method === "POST"
    ) {
      state.restoreWorkspaceRequests += 1;
      upsertFile(state, "group_vars/all.yml", "restored: true\n");
      return fulfillJson(route, 200, { ok: true, sha: state.commitSha });
    }
    if (
      path ===
        `/api/workspaces/${state.workspaceId}/history/${state.commitSha}/restore-file` &&
      method === "POST"
    ) {
      state.restorePathRequests += 1;
      const body = JSON.parse(req.postData() || "{}");
      const requestedPath = String(body?.path || "");
      if (requestedPath) {
        upsertFile(state, requestedPath, "restored: path\n");
      }
      return fulfillJson(route, 200, {
        ok: true,
        sha: state.commitSha,
        path: requestedPath || null,
      });
    }

    if (
      path === `/api/workspaces/${state.workspaceId}/generate-inventory` &&
      method === "POST"
    ) {
      return fulfillJson(route, 200, {
        workspace_id: state.workspaceId,
        inventory_path: "inventory.yml",
        files: state.files,
        warnings: [],
      });
    }

    return fulfillJson(route, 200, { ok: true });
  });

  return state;
}

test("history entry point is available via workspace menu only", async ({
  page,
}) => {
  await mockWorkspaceApi(page);
  await page.goto("/");

  await page.getByRole("tab", { name: "Inventory" }).click();

  await expect(page.getByRole("button", { name: "History" })).toHaveCount(0);
  await page.getByRole("button", { name: "Workspace" }).click();
  await expect(page.getByRole("button", { name: "History" })).toBeVisible();

  await page.getByRole("button", { name: "History" }).click();
  await expect(page.getByRole("heading", { name: "Workspace History" })).toBeVisible();
  await expect(page.getByText("Scope: entire workspace")).toBeVisible();
});

test("editing a file triggers a debounced autosave commit", async ({ page }) => {
  const state = await mockWorkspaceApi(page);
  await page.goto("/");
  await page.getByRole("tab", { name: "Inventory" }).click();

  await expect.poll(() => state.saveRequests).toBe(0);
  await page.getByText("all.yml", { exact: true }).click();
  await page.locator(".cm-content").click();
  await page.keyboard.type("\nautosave: true");

  await expect.poll(() => state.saveRequests, { timeout: 4000 }).toBeGreaterThan(0);
});

test("file and folder context menu history uses scoped queries", async ({ page }) => {
  const state = await mockWorkspaceApi(page);
  await page.goto("/");
  await page.getByRole("tab", { name: "Inventory" }).click();

  await page.getByText("all.yml", { exact: true }).click({ button: "right" });
  await page.getByRole("button", { name: "History" }).click();
  await expect(
    page.getByText("Scope: group_vars/all.yml", { exact: false })
  ).toBeVisible();
  await expect(page.getByText("********")).toBeVisible();
  await expect(page.getByText(state.rawToken)).toHaveCount(0);
  await page.getByRole("button", { name: "Close" }).click();

  await page.getByText("group_vars", { exact: true }).click({ button: "right" });
  await page.getByRole("button", { name: "History" }).click();
  await expect(
    page.getByText("Scope: group_vars (recursive)", { exact: false })
  ).toBeVisible();
  await expect(state.historyPathQueries).toContain("group_vars/all.yml");
  await expect(state.historyPathQueries).toContain("group_vars");
});

test("restore workspace triggers refresh feedback", async ({ page }) => {
  const state = await mockWorkspaceApi(page);
  await page.goto("/");
  await page.getByRole("tab", { name: "Inventory" }).click();
  await page.getByRole("button", { name: "Workspace" }).click();
  await page.getByRole("button", { name: "History" }).click();
  await expect(page.getByRole("heading", { name: "Workspace History" })).toBeVisible();

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Restore workspace" }).click();

  await expect(page.getByText("Workspace restored.")).toBeVisible();
  await expect.poll(() => state.restoreWorkspaceRequests).toBe(1);
});

test("unsaved changes guard can save-and-leave and flush pending write", async ({
  page,
}) => {
  const state = await mockWorkspaceApi(page);
  await page.goto("/");
  await page.getByRole("tab", { name: "Inventory" }).click();

  await page.getByText("all.yml", { exact: true }).click();
  await page.locator(".cm-content").click();
  await page.keyboard.type("\nchanged: yes");

  await page.getByRole("tab", { name: "Setup" }).click();
  await expect(page.getByRole("heading", { name: "Unsaved changes" })).toBeVisible();
  await page.getByRole("button", { name: "Save and leave" }).click();

  await expect.poll(() => state.saveRequests).toBeGreaterThan(0);
  await expect(page.getByRole("tab", { name: "Setup" })).toHaveAttribute(
    "aria-selected",
    "true"
  );
});

test("users overview can add and persist a user to group_vars/all.yml", async ({
  page,
}) => {
  const state = await mockWorkspaceApi(page);
  await page.goto("/");
  await page.getByRole("tab", { name: "Inventory" }).click();

  await page.getByRole("button", { name: "Users" }).click();
  await page.getByRole("button", { name: "Overview" }).click();
  await expect(page.getByText("Users overview from")).toBeVisible();

  await page.getByRole("button", { name: "New" }).click();
  await expect(page.getByRole("heading", { name: "Add user" })).toBeVisible();

  await page.getByLabel("Username* (a-z0-9)").fill("alice");
  await page.getByLabel("Firstname*").fill("Alice");
  await page.getByLabel("Lastname*").fill("Admin");
  await page.getByLabel("Email (optional)").fill("alice@example.local");
  await page.getByRole("button", { name: "Add user" }).click();

  await expect(page.getByText("alice", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Save users" }).click();

  await expect(
    page.getByText("Saved 1 user(s) to group_vars/all.yml.", { exact: true })
  ).toBeVisible();
  await expect.poll(() => state.fileContents["group_vars/all.yml"]).toContain(
    "users:\n  alice:"
  );
  await expect.poll(() => state.fileContents["group_vars/all.yml"]).toContain(
    "username: alice"
  );
  await expect.poll(() => state.fileContents["group_vars/all.yml"]).not.toContain(
    "- username: alice"
  );
});
