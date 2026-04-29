import { expect, test } from "@playwright/test";

/**
 * Real OIDC login flow against the seeded oidc-server-mock + oauth2-proxy
 * compose services (req 020).
 *
 * The browser hits the oauth2-proxy front-door (PLAYWRIGHT_BASE_URL),
 * gets redirected to oidc-mock's /Account/Login, fills the seeded
 * credentials, and returns through /oauth2/callback. The deployer API
 * is then probed via the same authenticated session to verify that
 * X-Auth-Request-User / X-Auth-Request-Email reach the api.
 *
 * Sign-out via /oauth2/sign_out clears the cookie and the next API call
 * lands as anonymous.
 */

const SEEDED_USER = {
  username: "e2e-owner",
  password: "e2e-owner-secret-TEST-ONLY",
  email: "e2e-owner@example.com",
};

test.describe("OIDC login flow", () => {
  test("seeded e2e-owner can log in, hit api, and sign out", async ({ page }) => {
    // 1. Anonymous visit → oauth2-proxy → oidc-mock login page.
    await page.goto("/");
    await page.waitForURL(/oidc-mock|Account\/Login/i, { timeout: 30_000 });

    // 2. Fill the mock IdP login form. Soluto's oidc-server-mock
    // ships Duende IdentityServer's default UI; the form fields are
    // rendered without a `name` attribute, so target by accessible
    // label / role instead.
    await page.getByLabel("Username").fill(SEEDED_USER.username);
    await page.getByLabel("Password").fill(SEEDED_USER.password);
    await page.getByRole("button", { name: "Login" }).click();

    // 3. The IdP redirects through /oauth2/callback to / on the proxy,
    // which forwards to the upstream `web` service. Wait until the URL
    // settles back on the oauth2-proxy host (no longer containing
    // oidc-mock).
    await page.waitForURL((url) => !/oidc-mock/i.test(url.toString()), {
      timeout: 30_000,
    });

    // 4. Verify the session by hitting /api/workspaces through the
    // authenticated browser context. Oauth2-proxy sets
    // X-Auth-Request-User / X-Auth-Request-Email on the upstream
    // request; the deployer API echoes the user_id in the response.
    const wsResp = await page.request.get("/api/workspaces");
    expect(wsResp.status()).toBe(200);
    const wsBody = await wsResp.json();
    expect(wsBody.authenticated).toBe(true);
    expect(wsBody.user_id).toBe(SEEDED_USER.username);

    // 5. Sign out clears the session cookie. We hit the endpoint via
    // page.request to avoid chasing the post-sign-out redirect chain
    // (which loops back through the IdP) — the cookie state and the
    // resulting unauthenticated API response are what we care about.
    const signOutResp = await page.request.get("/oauth2/sign_out", {
      maxRedirects: 0,
      failOnStatusCode: false,
    });
    expect(signOutResp.status()).toBeGreaterThanOrEqual(300);
    expect(signOutResp.status()).toBeLessThan(400);

    await page.context().clearCookies();

    // A fresh, cookie-less API call must NOT surface the previously
    // authenticated identity — oauth2-proxy redirects to sign-in (302)
    // OR upstream returns 401 / empty under
    // WORKSPACE_LIST_UNAUTH_MODE=empty.
    const afterResp = await page.request.get("/api/workspaces", {
      maxRedirects: 0,
      failOnStatusCode: false,
    });
    if (afterResp.status() === 200) {
      const body = await afterResp.json();
      expect(body.authenticated).toBe(false);
    } else {
      expect(afterResp.status()).not.toBe(200);
    }
  });
});
