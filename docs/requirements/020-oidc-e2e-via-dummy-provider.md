# 020 - End-to-End OIDC via OAuth2 Proxy + Dummy Provider

## User Story

As a contributor, I want the deployer's e2e test stack to exercise the full OIDC login flow against a real OAuth2 Proxy and a dummy OIDC provider, so that the auth path used in production (browser → OAuth2 Proxy → OIDC IdP → callback → upstream) is actually tested and not only mocked at the header level.

## Background

Requirement [007](007-optional-auth-persistent-workspaces.md) defined OAuth2-Proxy-based authentication: the deployer trusts the proxy-set headers `X-Auth-Request-User` and `X-Auth-Request-Email` ([apps/api/api/auth.py:27-41](../../apps/api/api/auth.py#L27-L41)) and never implements its own auth logic. Today the e2e harness does not run an OAuth2 Proxy at all — the unit tests at [tests/python/unit/test_workspace_access_security.py:47-63](../../tests/python/unit/test_workspace_access_security.py#L47-L63) inject the headers directly via the test client. There is no e2e coverage of the redirect-to-IdP, callback, session-cookie, or logout flow.

This requirement adds two compose services, both gated behind the `test` profile, to close that gap:

- `oauth2-proxy` — the same reverse-proxy used in production, configured to sit in front of the `web` service.
- `oidc-mock` — a small OIDC server that issues tokens for seeded test users, replacing real IdPs in the e2e lane.

Production deployments are unaffected: neither service runs in the production / non-test profile, and the existing header-based contract is preserved.

## Scope

- **Test-profile only.** Both new services are members of the existing `test` Compose profile; neither runs by default. `make e2e-dashboard-ci-docker` brings them up; `make up` (the dev stack) does not.
- **Dummy provider: [`ghcr.io/soluto/oidc-server-mock`](https://github.com/Soluto/oidc-server-mock).** Pinned by digest. Configured via env / mounted JSON to seed two users + one client. Chosen over `dex` because it is purpose-built for tests and configurable in a single env block, while `dex` requires a static config plus a CRD-style client registration step.
- **OAuth2 Proxy: [`quay.io/oauth2-proxy/oauth2-proxy`](https://oauth2-proxy.github.io/oauth2-proxy/)** (the canonical upstream image). Pinned by digest. Configured to terminate the OIDC flow against `oidc-mock`, set the `X-Auth-Request-User` / `X-Auth-Request-Email` headers, and forward to the existing `web` service.
- **Existing unit-test header-mock path stays.** It is faster, runs in-process, and tests the API's auth dependency in isolation — both layers have value. The new e2e covers the request-path that production actually serves.
- **Two seeded test users**, hard-coded in this spec:
  - `e2e-owner@example.com` / password `e2e-owner-secret` — the workspace owner in dashboard E2E.
  - `e2e-member@example.com` / password `e2e-member-secret` — used by requirement [019](019-workspace-rbac.md)'s membership tests.

## Architecture

```
                                                    ┌──────────────┐
                                                    │   oidc-mock  │
                                                    │ (port 8089)  │
                                                    │  /authorize  │
                                                    │  /token      │
                                                    │  /userinfo   │
                                                    │  /.well-known│
                                                    └──────▲───────┘
                                                           │ token exchange
                                                           │ jwks
   browser  ───────► oauth2-proxy ────────────────────────►┘
   (host)            (port 4180)
                          │ X-Auth-Request-User
                          │ X-Auth-Request-Email
                          ▼
                    web (port 3000)
                          │
                          ▼
                    api (port 8000)
```

OAuth2 Proxy publishes port `4180` on the host (e2e Playwright drives this). `web` and `api` no longer need a host port in the test profile; they are reachable only via the proxy.

The OAuth2 Proxy `--upstream` is `http://web:3000`. `--whitelist-domain` covers the local hostnames so post-login redirect back to the test browser works. `--reverse-proxy=true` is set so the proxy trusts `X-Forwarded-*` from Playwright's container.

## Compose Services

Both gated behind `profiles: ["test"]`, on the existing `infinito-deployer` network with static IPs in the existing `${DOCKER_NETWORK_SUBNET}` pool. Suggested addresses: `oidc-mock` at `172.28.0.40`, `oauth2-proxy` at `172.28.0.41` (clear of existing 172.28.0.10 / .20 / .30 / .31 assignments).

### oidc-mock

Image: `ghcr.io/soluto/oidc-server-mock@sha256:<pinned>`. Env-driven config; users + clients live in env vars, no separate file mount needed for the tiny seed. Healthcheck probes `GET /.well-known/openid-configuration`.

Required env (illustrative — final values land in `docker-compose.yml`):

```yaml
SERVER_OPTIONS_INLINE: |
  {
    "AccessTokenJwtType": "JWT",
    "Discovery": { "ShowKeySet": true },
    "Authentication": { "CookieSameSiteMode": "Lax" }
  }
CLIENTS_CONFIGURATION_INLINE: |
  [
    {
      "ClientId":     "infinito-deployer-e2e",
      "ClientSecrets": ["e2e-client-secret"],
      "AllowedGrantTypes": ["authorization_code"],
      "RedirectUris": ["http://localhost:4180/oauth2/callback"],
      "AllowedScopes": ["openid","profile","email"]
    }
  ]
USERS_CONFIGURATION_INLINE: |
  [
    {
      "SubjectId": "e2e-owner",
      "Username":  "e2e-owner",
      "Password":  "e2e-owner-secret",
      "Claims": [
        {"Type": "email",         "Value": "e2e-owner@example.com"},
        {"Type": "email_verified","Value": "true",  "ValueType":"boolean"},
        {"Type": "name",          "Value": "E2E Owner"}
      ]
    },
    {
      "SubjectId": "e2e-member",
      "Username":  "e2e-member",
      "Password":  "e2e-member-secret",
      "Claims": [
        {"Type": "email",         "Value": "e2e-member@example.com"},
        {"Type": "email_verified","Value": "true",  "ValueType":"boolean"},
        {"Type": "name",          "Value": "E2E Member"}
      ]
    }
  ]
```

### oauth2-proxy

Image: `quay.io/oauth2-proxy/oauth2-proxy@sha256:<pinned>`. Configured via flags / env. Healthcheck probes `GET /ping`.

Key flags / env:

| Flag                                     | Value                                                         |
|------------------------------------------|---------------------------------------------------------------|
| `--provider`                             | `oidc`                                                        |
| `--oidc-issuer-url`                      | `http://oidc-mock:8089`                                       |
| `--client-id`                            | `infinito-deployer-e2e`                                       |
| `--client-secret`                        | `e2e-client-secret`                                           |
| `--cookie-secret`                        | 32-byte random, generated at harness start                    |
| `--cookie-secure`                        | `false` (e2e runs over plain HTTP)                            |
| `--http-address`                         | `0.0.0.0:4180`                                                |
| `--upstream`                             | `http://web:3000`                                             |
| `--email-domain`                         | `*`                                                           |
| `--pass-user-headers`                    | `true`                                                        |
| `--set-xauthrequest`                     | `true` (sets `X-Auth-Request-User` and `X-Auth-Request-Email`) |
| `--reverse-proxy`                        | `true`                                                        |
| `--skip-provider-button`                 | `true` (auto-redirect to the only provider)                   |
| `--insecure-oidc-allow-unverified-email` | `false` (mock seeds `email_verified: true`)                   |

`--cookie-secret` MUST be generated at e2e-harness start (e.g. `head -c 32 /dev/urandom | base64 | tr -d '\n='`) and exported via the env-file the harness already builds. Never hard-coded.

## Harness Wiring

[scripts/e2e/dashboard/run.sh](../../scripts/e2e/dashboard/run.sh) gains:

1. A new env var `INFINITO_E2E_AUTH_MODE`, default `"header-mock"` (existing behaviour). When set to `"oidc-mock"`:
   - `oauth2-proxy` and `oidc-mock` are added to the phase-A startup set so they are healthy before the rest comes up.
   - The Playwright invocation receives `INFINITO_E2E_BASE_URL=http://localhost:4180` instead of `http://web:3000`.
   - The harness writes a 32-byte random `OAUTH2_PROXY_COOKIE_SECRET` into the existing env-file.
2. The header-mock path is unchanged when `INFINITO_E2E_AUTH_MODE=header-mock` (default). CI keeps running the cheaper mode by default; the OIDC mode is opt-in and run on a dedicated schedule.

A new Make target `make e2e-dashboard-ci-docker-oidc` wraps `INFINITO_E2E_AUTH_MODE=oidc-mock make e2e-dashboard-ci-docker` for discoverability.

## Acceptance Criteria

### Compose
- [x] `oidc-mock` and `oauth2-proxy` are members of the `test` profile only; both invisible to `make up`.
- [x] Both pin images by digest: `ghcr.io/soluto/oidc-server-mock@sha256:5730…9254` and `quay.io/oauth2-proxy/oauth2-proxy@sha256:b5b5…6731` (alpine variant — distroless `:v7.6.0` lacks a shell for healthchecks).
- [x] Both have `healthcheck:`; `oauth2-proxy.depends_on.oidc-mock.condition: service_healthy`. `web` is unchanged (the proxy upstreams to it; no reverse dependency).
- [x] Explicit `cpus: '0.5'` + `mem_limit: 256m` per service.
- [x] Port `4180` published only when the test profile is active (no host port in non-test).
- [x] `docker compose --profile test config -q` validates clean (verified post-edit).

### Functional behaviour (OIDC login flow)
- [x] `oidc-mock` returns the discovery document at `/.well-known/openid-configuration` (verified by healthcheck succeeding within 13 s).
- [x] `oauth2-proxy` performs OIDC discovery against `oidc-mock` at startup and reports `OAuthProxy configured for OpenID Connect Client ID: infinito-deployer-e2e` in its logs (verified during standalone bring-up).
- [x] `oauth2-proxy /ping` returns 200 from inside the compose network (verified by healthcheck succeeding within 6 s).
- [ ] Full browser-driven flow (redirect → mock login → callback → headers passed to api) — deferred Playwright spec; the building blocks (services up + healthy + discovery) are exercised by `make e2e-dashboard-ci-docker` which now starts both services without breaking the existing test path.

### Tests
- [ ] Playwright spec `tests/oidc_login.spec.ts` — deferred (kept existing header-mock e2e green; OIDC-driven Playwright spec lands in a follow-up so the regression surface is one change at a time).
- [ ] Playwright spec for cross-user RBAC via OIDC — deferred (same reason).
- [x] The existing dashboard E2E spec keeps passing under `INFINITO_E2E_AUTH_MODE=header-mock` (default) — verified by the closing e2e in this iteration: 2/2 in 29.6 m with both new services healthy.

### Failure modes
- [x] `oauth2-proxy.depends_on.oidc-mock.condition: service_healthy` ensures the proxy never starts against a dead IdP; the harness fails in phase A.
- [x] Cookie-secret is 32 bytes per harness run; oauth2-proxy enforces the length check at startup.
- [x] Restarting `oauth2-proxy` invalidates cookies (per-run secret) — documented in the README cross-reference.

### Security
- [x] `oidc-mock` is reachable only from the compose network (no host port published); `oauth2-proxy:4180` is the only exposed port.
- [x] Mock secrets are clearly suffixed `-TEST-ONLY` in the compose file so a copy-paste into prod is hard to miss in review.
- [x] `oauth2-proxy --cookie-secret` is generated fresh in `scripts/e2e/dashboard/run.sh` (`head -c 32 /dev/urandom | base64`) and only lives in the temp env-file consumed by compose.
- [x] No real IdP credentials are loaded by the e2e under any circumstance.

### Documentation
- [ ] Contributor doc for OIDC mode — deferred until the Playwright OIDC spec lands; the Make target `e2e-dashboard-ci-docker-oidc` is self-documenting via the comment on the recipe.
- [x] Compose comment headers for both services reference this requirement.

## Out of Scope

- Production OIDC integration (real IdP wiring, secret management, multi-tenant client config). That is owned by the deployment / hosting layer, not this repo.
- Replacing the unit-test header-mock path with the real OIDC flow. The header-mock stays as the fast inner-loop test; this requirement adds the real-flow lane on top.
- Refresh-token / token-rotation semantics. The mock issues short-lived tokens; for an e2e that takes minutes, refresh is not exercised.
- SSO logout / global logout across multiple downstreams. Single-app logout is enough.
- Persisting OIDC user records to a deployer-side user table — there is none, by design (req 007), and req [019](019-workspace-rbac.md) keeps it that way.

## Cross-References

- [007 - Optional Login & Persistent Workspaces (OAuth2 Proxy)](007-optional-auth-persistent-workspaces.md) — the auth-header contract this requirement actually exercises end-to-end.
- [019 - Workspace RBAC: Owner + Member Memberships](019-workspace-rbac.md) — the membership tests in 019 acceptance use the two seeded users defined here.
- [014 - E2E Test: Deploy web-app-dashboard to a Local Container](014-e2e-dashboard-deploy.md) — the existing e2e harness this requirement extends with a second auth mode.
- [018 - Build-Cache Infrastructure](018-local-build-cache-infrastructure.md) — same pattern for adding compose services in the test profile and pinning by digest.
