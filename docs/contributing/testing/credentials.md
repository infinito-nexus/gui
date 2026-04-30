# Test Credentials Reference 🔐

Every static credential, password, key, and shared secret used by the local development and test stacks is listed here so contributors do not have to grep across `env.example`, `docker-compose.yml`, and the test Dockerfiles to find them.

## Security 🛑

- All values listed below are **test-only**. They MUST NOT appear in any production configuration, image, or secret store.
- The `-TEST-ONLY` suffix on OIDC values is intentional — a copy-paste into a production config is then immediately obvious in review.
- The technical authoritative source for each value is the file linked in the "Source" column of each table. This document only mirrors them for human reference; do not edit credentials here without changing the source file.

## Database (development default) 🗄️

The local Postgres container ships with weak development credentials so `make setup` works on a clean checkout without manual `.env` edits. Override `POSTGRES_PASSWORD` in `.env` for any non-throwaway environment.

| Field    | Value                  | Source                                                    |
|----------|------------------------|-----------------------------------------------------------|
| Host     | `db`                   | [docker-compose.yml](../../../docker-compose.yml)         |
| Port     | `5432`                 | [docker-compose.yml](../../../docker-compose.yml)         |
| Database | `infinito_deployer`    | [env.example](../../../env.example)                       |
| User     | `infinito`             | [env.example](../../../env.example)                       |
| Password | `infinito`             | [env.example](../../../env.example)                       |

## SSH Test Services 🔌

Three SSH test images live under [apps/test/](../../../apps/test/) and are started with `make test-env-up`. They share the same login user but differ in auth method and listening port.

### `ssh-password`

| Field          | Value         | Source                                                              |
|----------------|---------------|---------------------------------------------------------------------|
| Host (in compose net) | `ssh-password` | [docker-compose.yml](../../../docker-compose.yml)            |
| Host port (host net)  | `2222`         | [docker-compose.yml](../../../docker-compose.yml)            |
| Container port        | `22`           | [docker-compose.yml](../../../docker-compose.yml)            |
| User           | `deploy`       | [Dockerfile](../../../apps/test/ssh-password/Dockerfile)            |
| Password       | `deploy`       | [Dockerfile](../../../apps/test/ssh-password/Dockerfile)            |

### `ssh-key`

| Field          | Value                                          | Source                                                              |
|----------------|------------------------------------------------|---------------------------------------------------------------------|
| Host (in compose net) | `ssh-key`                                | [docker-compose.yml](../../../docker-compose.yml)                   |
| Host port (host net)  | `2223`                                   | [docker-compose.yml](../../../docker-compose.yml)                   |
| Container port        | `22`                                     | [docker-compose.yml](../../../docker-compose.yml)                   |
| User           | `deploy`                                       | [Dockerfile](../../../apps/test/ssh-key/Dockerfile)                 |
| Private key    | [test_id_ed25519](../../../apps/test/ssh-key/test_id_ed25519)         | tracked file (test-only)              |
| Public key     | [test_id_ed25519.pub](../../../apps/test/ssh-key/test_id_ed25519.pub) | tracked file (test-only)              |

The public key is pre-installed in the image's `~deploy/.ssh/authorized_keys`, so `ssh -i apps/test/ssh-key/test_id_ed25519 -p 2223 deploy@localhost` works without further setup.

### `arch-ssh`

The `arch-ssh` runner image is the deploy target for the dashboard E2E suite. It exposes the same `deploy` / `deploy` password pair so the e2e harness can ssh into it without provisioning keys.

| Field    | Value     | Source                                                       |
|----------|-----------|--------------------------------------------------------------|
| User     | `deploy`  | [Dockerfile](../../../apps/test/arch-ssh/Dockerfile)         |
| Password | `deploy`  | [Dockerfile](../../../apps/test/arch-ssh/Dockerfile)         |

## OIDC E2E Stack 🎟️

The OAuth2-Proxy + `oidc-mock` pair lives behind the `test` Compose profile. See the architecture in [requirement 020](../../requirements/020-oidc-e2e-via-dummy-provider.md).

### Seeded users

| Role             | Username     | Password                       | Email                       | Source                                            |
|------------------|--------------|--------------------------------|-----------------------------|---------------------------------------------------|
| Workspace owner  | `e2e-owner`  | `e2e-owner-secret-TEST-ONLY`   | `e2e-owner@example.com`     | [docker-compose.yml](../../../docker-compose.yml) |
| Workspace member | `e2e-member` | `e2e-member-secret-TEST-ONLY`  | `e2e-member@example.com`    | [docker-compose.yml](../../../docker-compose.yml) |

### OIDC client (proxy ↔ IdP)

| Field                    | Value                              | Source                                            |
|--------------------------|------------------------------------|---------------------------------------------------|
| Client ID                | `infinito-deployer-e2e`            | [docker-compose.yml](../../../docker-compose.yml) |
| Client secret            | `e2e-client-secret-TEST-ONLY`      | [docker-compose.yml](../../../docker-compose.yml) |
| Issuer (compose-internal)| `http://oidc-mock:8089`            | [docker-compose.yml](../../../docker-compose.yml) |
| Browser entry point      | `http://localhost:4180`            | published port on `oauth2-proxy`                  |

### Cookie secret

`oauth2-proxy`'s cookie secret is **not** static. The e2e harness generates a fresh 32-byte base64 secret per run, writes it into the temp env-file the harness builds, and lets it expire when the run ends. It is never committed; do not paste a value here.

## Workspace Import (UI prompt) 📦

The example workspace at [examples/workspace/](../../../examples/workspace/) intentionally does NOT bake in any deploy credentials. When the UI prompts after import, enter:

| Field        | Value      |
|--------------|------------|
| Auth method  | `password` |
| Password     | `deploy`   |

(The user is implied by `host_vars/test-arch.yml`, which sets `ansible_user=deploy`.)

## Where each value lives 🗺️

If you need to rotate or change a value, edit the **source** file in the table above — not this document. The expected change-sites are:

| Concern                           | File to edit                                                |
|-----------------------------------|-------------------------------------------------------------|
| Postgres dev password             | [env.example](../../../env.example)                         |
| `ssh-password` user/password      | [Dockerfile](../../../apps/test/ssh-password/Dockerfile)    |
| `ssh-key` keypair                 | [test_id_ed25519](../../../apps/test/ssh-key/test_id_ed25519) and `.pub` |
| `arch-ssh` user/password          | [Dockerfile](../../../apps/test/arch-ssh/Dockerfile)        |
| OIDC seeded users                 | [docker-compose.yml](../../../docker-compose.yml) (`oidc-mock` block) |
| OIDC client id / client secret    | [docker-compose.yml](../../../docker-compose.yml) (`oidc-mock` and `oauth2-proxy` blocks) |

After editing, update the matching row in this document so it stays accurate.
