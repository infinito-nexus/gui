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
The cap is informational; per-tool caps in this directory's config files
are what actually constrain disk use.

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
└── `s6-rc.d/`                s6-overlay v3 service definitions
    ├── `apt-cacher-ng/{type,run,dependencies.d/base}`
    ├── `devpi/{type,run,dependencies.d/base}`
    ├── `verdaccio/{type,run,dependencies.d/base}`
    └── `user/contents.d/{apt-cacher-ng,devpi,verdaccio}`  (enables them)

## How the dashboard build consumes the cache

Build args injected by [scripts/e2e/dashboard/run.sh](../../scripts/e2e/dashboard/run.sh)
into the rendered Compose env-file. The dashboard's Dockerfile (in the
upstream `port-ui` repo, NOT in this repo) reads the args and rewrites
each package manager's config when they are non-empty. See requirement
[018](../../docs/requirements/018-local-build-cache-infrastructure.md)
for the exact `ARG` declarations and `RUN` snippets.

If the upstream Dockerfile doesn't read the args (current state — port-ui
PR pending), the cache container still starts and stays healthy; it
just sees no traffic.

## Network

Static IP `172.28.0.31` on the outer compose network. Build containers
inside ssh-password's nested DinD reach the cache by IP because
outer-compose service names are unresolvable from the inner DinD's DNS.

## Persistence

Bind mount `state/e2e/cache-package/` → `/state/cache-package/` (single
mount point). Per-tool subdirectories `apt/`, `pip/`, `npm/` are created
and chowned on every container start by `entrypoint.sh`.

Wipe with `make e2e-dashboard-wipe-caches` (stops the service first).
