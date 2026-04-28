# cache-package

Single container that bundles three pull-through caches for the e2e
test stack:

| protocol | upstream                          | port | tool                          | size cap |
|----------|-----------------------------------|------|-------------------------------|----------|
| apt      | `http://deb.debian.org/`, etc.    | 3142 | `apt-cacher-ng`               | 4 GB     |
| pip      | `https://pypi.org/simple/`        | 3141 | `devpi-server` (mirror index) | 2 GB     |
| npm      | `https://registry.npmjs.org/`     | 4873 | `verdaccio` (uplink: npmjs)   | 2 GB     |

Total host-disk footprint capped at 8 GB
(`CACHE_PACKAGE_MAX_SIZE=8g`, see requirement
[018](../../docs/requirements/018-local-build-cache-infrastructure.md)).
The cap is enforced by an s6-supervised `gc` longrun service running
[`gc.sh`](files/gc.sh): every 24 h (or every 30 min when over budget)
it sums `du -sb /state/cache-package`, and when above the cap it stops
the s6 service that owns the largest subdir, wipes that subdir, and
restarts the service. Re-fetch on next pull is acceptable because the
e2e is not latency-sensitive at minute scale, and none of the three
upstream tools (apt-cacher-ng, devpi, verdaccio) ships a built-in
hard size cap.

## Why one container

The three tools share the same purpose (cache packages) but speak
different protocols. Running them in one container reduces compose
service sprawl and matches the "two cache containers" architectural
constraint of requirement 018. The supervisor is `s6-overlay` v3 — its
`s6-rc.d/` layout is what `files/s6-rc.d/` mirrors.

## Build context

`docker compose --profile test build cache-package` builds
`infrastructure/svc-cache-package/files/Dockerfile`. The image is not
published; it lives only in the local docker daemon.

`files/`
├── `Dockerfile`              base image, tool installs, COPY of below
├── `entrypoint.sh`           per-start chown of bind-mounted state
│                             dirs + idempotent `devpi-init`
├── `configs/`
│   ├── `acng.conf`           apt-cacher-ng config
│   └── `verdaccio.yaml`      verdaccio config
├── `gc.sh`                  size-cap enforcement run by s6-rc `gc`
└── `s6-rc.d/`                s6-overlay v3 service definitions
    ├── `apt-cacher-ng/{type,run,dependencies.d/base}`
    ├── `devpi/{type,run,dependencies.d/base}`
    ├── `verdaccio/{type,run,dependencies.d/base}`
    ├── `gc/{type,run,dependencies.d/base}`
    └── `user/contents.d/{apt-cacher-ng,devpi,verdaccio,gc}`  (enables them)

## How the deployer images consume the cache

Build args injected by [scripts/e2e/dashboard/run.sh](../../scripts/e2e/dashboard/run.sh)
into the rendered Compose env-file. Each consumer Dockerfile in this
repo reads the args and rewrites its package-manager config when they
are non-empty:

| consumer Dockerfile               | `INFINITO_CACHE_*` args used                       |
|-----------------------------------|---------------------------------------------------|
| `apps/api/Dockerfile`             | `APT_PROXY` + `PIP_INDEX_URL`                     |
| `apps/web/Dockerfile`             | `NPM_REGISTRY`                                    |
| `apps/test/playwright/Dockerfile` | `APT_PROXY`                                       |
| `apps/test/{ssh-password,arch-ssh,ssh-key}/Dockerfile` | (Arch / pacman — out of scope) |

The compose `build.args:` blocks of the corresponding services
forward the env-file values into the `docker build`. Empty values are
the production-safe default — when the cache services aren't reachable,
the consumer Dockerfile falls through to public mirrors.

## Network

Static IP `172.28.0.31` on the outer compose network. Build containers
inside ssh-password's nested DinD reach the cache by IP because
outer-compose service names are unresolvable from the inner DinD's DNS.

## Persistence

Bind mount `state/e2e/cache-package/` → `/state/cache-package/` (single
mount point). Per-tool subdirectories `apt/`, `pip/`, `npm/` are created
and chowned on every container start by `entrypoint.sh`.

Wipe with `make e2e-dashboard-wipe-caches` (stops the service first).
