import { defineConfig } from "@playwright/test";

/**
 * UI tier (req: CI restructure) — Playwright with mocked API only.
 *
 * Whitelisted specs:
 *   - audit_logs                       (mocks /api/workspaces/.../logs/*)
 *   - csrf_bootstrap                   (mocks /api session bootstrap)
 *   - role_dashboard_scope_row_mode    (mocks /api/roles)
 *   - role_quick_links                 (mocks /api/roles)
 *   - security_headers                 (mocks /api response headers)
 *   - workspace_history                (mocks /api/workspaces/.../history)
 *
 * Excluded specs (real-stack E2Es, run via .github/workflows/e2e.yml):
 *   - dashboard_deploy_real
 *   - dashboard-perf
 *   - oidc_login
 */
export default defineConfig({
  testDir: "./tests",
  testMatch:
    /(audit_logs|csrf_bootstrap|role_dashboard_scope_row_mode|role_quick_links|security_headers|workspace_history)\.spec\.ts/,
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:3000",
  },
  webServer: {
    command:
      "npm run build && mkdir -p .next/standalone/.next && cp -R .next/static .next/standalone/.next/ && cp -R public .next/standalone/ && HOSTNAME=127.0.0.1 PORT=3000 node .next/standalone/server.js",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
  },
});
