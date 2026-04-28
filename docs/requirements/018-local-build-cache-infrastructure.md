# 018 - Build-Cache Infrastructure (cache-registry + cache-package)

## User Story

As a developer iterating on the e2e dashboard deploy flow, I want a `cache-registry` for container images and a `cache-package` for language package managers (apt, pip, npm), each running as its own Compose service in the test profile, so that repeated runs (locally AND in CI) do not re-download the same blobs and packages from the public internet on every cold cache.

## Mode and Scope

- Both cache services run **in the existing `test` Compose profile**, alongside today's e2e services. Local runs and CI runs use the same setup.
- The dashboard target's deployment build (`web-app-dashboard` role's `RUN apt-get …` / `pip install …` / `npm install …`) is the canonical workload accelerated. Other roles benefit transparently when they pull from the same indexes.
- **Exactly two cache containers**, no more:
  - `cache-registry` — container image pull-through cache.
  - `cache-package` — language package pull-through cache (apt + pip + npm) in a single container.
- This requirement affects **three repositories** and MUST land as a coordinated triplet:
  - **`infinito-deployer`** — adds the cache services + harness wiring (this PR).
  - **`infinito-nexus`** — `roles/web-app-dashboard` (and similarly other build-using roles) propagates the deployer harness's build-args into its rendered Compose `build.args:` block so they reach the eventual `docker build`.
  - **`port-ui`** (https://github.com/kevinveenbirkenbach/port-ui) — owns the actual Dockerfile that the dashboard build runs (`web-app-dashboard` clones this repo at deploy time and builds its `Dockerfile` directly; `services/repository/Dockerfile` inside ssh-password is the cloned copy). The `ARG INFINITO_CACHE_*` declarations and the conditional `RUN` snippets shown in *Build-Time Wiring* below MUST be added to **port-ui's** `Dockerfile`. The Dockerfile is NOT in infinito-nexus.
- Each side landing alone produces NO regression but NO speedup either:
  - deployer alone: cache services run, builds ignore them → containers idle, builds hit public upstream.
  - infinito-nexus alone: build-args present in compose, port-ui Dockerfile ignores them.
  - port-ui alone: Dockerfile reads ARGs but compose never supplies them → falls through to empty defaults.
- Same model applies to any other app role that has its own `Dockerfile` in a separate upstream repo — the cache consumer change is owned by whichever repo owns the Dockerfile.

## Cache Components

### `cache-registry` (already shipped, formalised here)

- Upstream: `https://registry-1.docker.io`.
- Implementation: stock `registry:2` configured with `REGISTRY_PROXY_REMOTEURL`.
- Endpoint: `http://infinito-deployer-cache-registry:5000/`.
- Static IP on the outer compose network: `172.28.0.30` (set via compose `networks.default.ipv4_address`).
- Consumed by: ssh-password's inner DinD via `--registry-mirror=http://infinito-deployer-cache-registry:5000/` CLI flag plus matching `insecure-registries` entry in daemon.json.
- Persistence: bind mount `state/e2e/cache-registry/` (uid/gid of the container's `registry` user; cleaned via `make e2e-dashboard-wipe-caches` in a privileged alpine container).
- **Default size cap: 16 GB** (`CACHE_REGISTRY_MAX_SIZE=16g`). Enforcement: `registry garbage-collect` is destructive when run while the registry is serving requests, so the standard at-rest pattern applies:
  1. `REGISTRY_STORAGE_DELETE_ENABLED=true` is set in the environment so deletes are allowed at all.
  2. A periodic side-car cron (s6-overlay or a tiny `cron` sidecar inside the same `cache-registry` container) runs `registry garbage-collect /etc/docker/registry/config.yml --delete-untagged` ONLY after temporarily setting the registry to read-only (`REGISTRY_STORAGE_MAINTENANCE_READONLY={"enabled":true}` via SIGHUP) and reverts read-only afterwards.
  3. The cron triggers when `du -sb /var/lib/registry` exceeds `CACHE_REGISTRY_MAX_SIZE`. Frequency: every 30 min when above threshold, otherwise daily.
  4. The script lives at `infrastructure/svc-cache-registry/files/gc.sh` and is referenced from the s6-rc service definition.
  5. The healthcheck does NOT invoke GC (mixing concerns); healthcheck only probes `GET /v2/`.
- Scope: docker.io only. ghcr.io, quay.io, etc. pull direct (they have not historically had rate-limit or upstream-IP issues on GitHub-Actions runners).

### `cache-package` (new — single container, multi-process)

- Upstream(s): debian/ubuntu apt repos, pypi.org / pythonhosted.org, registry.npmjs.org.
- Implementation: a **custom-built image** bundling three OSS pull-through proxies, supervised by **`s6-overlay` v3** (NOT v2 — the layout under `/etc/s6-overlay/s6-rc.d/` differs between versions and v3 is the supported line).
- Internal processes (each managed by an `s6-overlay` v3 service definition under `/etc/s6-overlay/s6-rc.d/<name>/run`):
  - `apt-cacher-ng` (Debian/Ubuntu) on port `3142` → cache dir `/state/cache-package/apt`
  - `devpi-server` (PyPI) on port `3141` → server dir `/state/cache-package/pip`
  - `verdaccio` (npm) on port `4873` → storage dir `/state/cache-package/npm`
- Image source: `infrastructure/svc-cache-package/files/Dockerfile`. Base image: `debian:trixie-slim`. Build context contains the supervisor configuration under `s6-rc.d/`.
- Static IP on the outer compose network: `172.28.0.31`.
- Endpoints (single container, three ports):
  - `http://172.28.0.31:3142/` — apt
  - `http://172.28.0.31:3141/root/pypi/+simple/` — pip (devpi PyPI mirror endpoint)
  - `http://172.28.0.31:4873/` — npm
- Persistence: a single bind mount `state/e2e/cache-package/` is mounted at `/state/cache-package/` inside the container; the entrypoint creates and chowns the three subdirectories (`apt/`, `pip/`, `npm/`) on every start so a fresh host directory works without manual setup. Ownership map:
  - `apt/` → `apt-cacher-ng:apt-cacher-ng` (uid/gid created in the Dockerfile via `useradd -r`)
  - `pip/` → `devpi:devpi`
  - `npm/` → `verdaccio:verdaccio`
- **devpi initial setup** runs at first start as part of the entrypoint (idempotent — guarded by a marker file `/state/cache-package/pip/.initialised`):
  1. `devpi-init --serverdir /state/cache-package/pip` (creates the server state and the default root user with random password).
  2. `devpi-server --serverdir /state/cache-package/pip --start` (background-start to let the next steps talk to it).
  3. `devpi-server` is configured with `--mirror-cache-expiry=1800` (30 min) and `--restrict-modify=root` so other users cannot mutate the proxy index.
  4. The default `root/pypi` mirror index already exists after `devpi-init`; it transparently proxies https://pypi.org/. No additional `devpi-admin user` / `devpi index --create` calls are needed for the read-only proxy use case.
  5. After init completes, the entrypoint touches `/state/cache-package/pip/.initialised` and hands off to s6-overlay's normal supervision.
- **Default size cap: 8 GB total** (`CACHE_PACKAGE_MAX_SIZE=8g`). Enforcement, split per process:
  - apt-cacher-ng: 4 GB via `CacheDir` size cap in `acng.conf`.
  - devpi: 2 GB via age-based LRU pruning (`devpi-server --serverdir … --offline-mode=false` + a periodic `find … -atime +N -delete` cron job in s6).
  - verdaccio: 2 GB via `max_storage` directive in `config.yaml`.
  - Per-process caps documented in the component README; the env var `CACHE_PACKAGE_MAX_SIZE` is informational and NOT auto-distributed across the three (an implementer who wants different splits MUST edit the per-tool config files in the build context).

## Network Reachability (the hard part)

Build containers spawned inside ssh-password's inner DinD daemon do NOT share the outer compose network's DNS. They cannot resolve the hostname `infinito-deployer-cache-package`. To make the caches reachable from inside the build:

- Both caches MUST receive **static IPs** on the outer compose network (`172.28.0.30` for cache-registry, `172.28.0.31` for cache-package — both in the existing `${DOCKER_NETWORK_SUBNET:-172.28.0.0/24}` pool).
- The harness MUST inject **IP-based** build-args, not hostnames. Build container's apt/pip/npm then connect by IP and bypass DNS entirely.
- Routing from the inner DinD bridge to the outer compose network already works because ssh-password is privileged and its inner daemon's bridge gateway is reachable from outer 172.28.0.0/24. This MUST be smoke-tested by the harness before declaring caches healthy.
- **Consistency note for ssh-password's existing `--registry-mirror=` config**: today it uses the hostname `infinito-deployer-cache-registry` because dockerd ITSELF (running on ssh-password's outer interface) can resolve outer compose names. That keeps working and MUST NOT be changed to an IP — only the build-args (which are consumed inside inner-DinD build containers) need IP form. Document this asymmetry inline in the `cache-registry` README so future readers don't "fix" it.

## Build-Time Wiring

The dashboard build (and any other future role that wants caching) MUST honour the cache endpoints via Dockerfile `ARG`s with empty defaults so the same Dockerfile remains valid even when no cache is reachable:

```dockerfile
ARG INFINITO_CACHE_APT_PROXY=""
ARG INFINITO_CACHE_PIP_INDEX_URL=""
ARG INFINITO_CACHE_NPM_REGISTRY=""

RUN if [ -n "$INFINITO_CACHE_APT_PROXY" ]; then \
      printf 'Acquire::http::Proxy "%s";\n' "$INFINITO_CACHE_APT_PROXY" > /etc/apt/apt.conf.d/01infinito-cache; \
    fi && \
    apt-get update && apt-get install -y --no-install-recommends nodejs npm && \
    rm -rf /var/lib/apt/lists/* /etc/apt/apt.conf.d/01infinito-cache

RUN if [ -n "$INFINITO_CACHE_PIP_INDEX_URL" ]; then \
      pip config set global.index-url "$INFINITO_CACHE_PIP_INDEX_URL"; \
      pip config set global.trusted-host "$(printf '%s' "$INFINITO_CACHE_PIP_INDEX_URL" | awk -F[/:] '{print $4}')"; \
    fi && \
    pip install --no-cache-dir .

RUN if [ -n "$INFINITO_CACHE_NPM_REGISTRY" ]; then \
      npm config set registry "$INFINITO_CACHE_NPM_REGISTRY"; \
    fi && \
    npm install --prefix /app
```

The deployer harness ([scripts/e2e/dashboard/run.sh](../../scripts/e2e/dashboard/run.sh)) MUST inject the following build-args into the rendered Compose file in BOTH local and CI runs (when the cache services are healthy):

| build arg | value (when caches up) | empty fallback semantics |
|---|---|---|
| `INFINITO_CACHE_APT_PROXY` | `http://172.28.0.31:3142` | empty → no apt proxy file written → apt hits public mirrors directly |
| `INFINITO_CACHE_PIP_INDEX_URL` | `http://172.28.0.31:3141/root/pypi/+simple/` | empty → no pip config change → pip uses default `https://pypi.org/simple/` |
| `INFINITO_CACHE_NPM_REGISTRY` | `http://172.28.0.31:4873/` | empty → no npm config change → npm uses default `https://registry.npmjs.org/` |

Build-arg names MUST be prefixed `INFINITO_CACHE_*` so they are easy to grep for and never collide with existing variables.

## Compose Wiring

- `cache-registry` and `cache-package` are members of the `test` Compose profile.
- Both have `healthcheck:` blocks; ssh-password's `depends_on:` MUST require both `service_healthy`.
- Both have explicit resource limits to prevent runaway:
  - `cache-registry`: `cpus: '1.0'`, `mem_reservation: 256m`, `mem_limit: 1g`.
  - `cache-package`: `cpus: '1.5'`, `mem_reservation: 512m`, `mem_limit: 2g` (devpi+verdaccio+apt-cacher-ng+s6 together).
- The default `TEST_UP_SERVICES` (in the Makefile) MUST include both caches so `make test-up` brings them up by default. All call sites that pass an explicit `TEST_UP_SERVICES="api db catalog runner-manager web ssh-password"` (in `tests/python/integration/test_security_hardening.py:STACK_SERVICES` and the api-smoke target in the Makefile) MUST be updated to also list the two caches.
- The CI workflow at [.github/workflows/tests.yml](../../.github/workflows/tests.yml) inherits the new defaults and runs the caches identically to local — no env var, no profile gate, no conditional.
- The `cache-package` service is built locally via compose's `build:` block; `docker compose --profile test up --build` triggers the build automatically on the first run and on Dockerfile / build-context changes. No manual `docker build` is needed.

## Harness Build-Arg Injection

The deployer harness ([scripts/e2e/dashboard/run.sh](../../scripts/e2e/dashboard/run.sh)) MUST render the cache build-args into the e2e environment file (the `--env-file` passed to `docker compose`) so they are available as `${INFINITO_CACHE_*}` substitutions everywhere they are referenced:

```sh
# Inside render_env_file(), after the other TEST_*_HOST_PATH lines:
cat >>"${target_file}" <<EOF
INFINITO_CACHE_APT_PROXY=http://172.28.0.31:3142
INFINITO_CACHE_PIP_INDEX_URL=http://172.28.0.31:3141/root/pypi/+simple/
INFINITO_CACHE_NPM_REGISTRY=http://172.28.0.31:4873/
EOF
```

The matching infinito-nexus `web-app-dashboard` role MUST then propagate them through its rendered Compose `build.args:` block:

```yaml
# templates/compose.yml.j2 (excerpt)
dashboard:
  build:
    context: services/repository
    args:
      INFINITO_CACHE_APT_PROXY:    "${INFINITO_CACHE_APT_PROXY:-}"
      INFINITO_CACHE_PIP_INDEX_URL: "${INFINITO_CACHE_PIP_INDEX_URL:-}"
      INFINITO_CACHE_NPM_REGISTRY: "${INFINITO_CACHE_NPM_REGISTRY:-}"
```

(`${VAR:-}` syntax means "empty string when unset" — required so production deploys without the env vars do NOT fail compose interpolation.)

## Persistence and Cleanup

- Each cache's bind-mount directory MUST live under `state/e2e/<component>/` so it is covered by the existing `state/` git-ignore rule.
- The cleanup target [`make e2e-dashboard-wipe-state`](../../scripts/e2e/dashboard/wipe-state.sh) MUST NOT touch cache directories — purging caches is a separate, explicit operation.
- A new `make e2e-dashboard-wipe-caches` target MUST exist for full cache reset:
  1. `docker compose --profile test stop cache-registry cache-package`
  2. `docker run --rm -v <state-dir>:/state alpine sh -c 'rm -rf /state/cache-registry/* /state/cache-package/*'`
- Cache sizes are bounded per component:
  - `cache-registry`: 16 GB default (`CACHE_REGISTRY_MAX_SIZE=16g`).
  - `cache-package`: 8 GB default (`CACHE_PACKAGE_MAX_SIZE=8g`); split internally between apt/pip/npm subprocesses (defaults documented in the component README).

## Acceptance Criteria

### Compose Wiring

- [ ] `cache-registry` and `cache-package` are both members of the `test` Compose profile.
- [ ] Both have static IPs (`172.28.0.30` and `172.28.0.31`) on `${DOCKER_NETWORK_SUBNET}`.
- [ ] ssh-password's `depends_on:` requires both `service_healthy`.
- [ ] Default `TEST_UP_SERVICES` includes both cache services; `make test-up` starts them by default.
- [ ] `make e2e-dashboard-local-docker`, `make e2e-dashboard-ci-docker`, and the CI workflow all bring them up identically.
- [ ] Compose file validates with `docker compose --profile test config -q`.

### Functional Behaviour (deployer side)

- [ ] First e2e run (cold cache, fresh `state/e2e/cache-{registry,package}/`) populates both directories with non-zero size.
- [ ] Second consecutive run uses the warm caches: tests pass AND the run is measurably faster than the cold run by at least 10 % wallclock.
- [ ] Each cache responds to a known-good request from inside the compose network with the upstream's expected content shape (smoke test in the harness for each cache):
  - `curl http://172.28.0.30:5000/v2/_catalog` → JSON listing
  - `curl http://172.28.0.31:3142/acng-report.html` → apt-cacher-ng HTML
  - `curl http://172.28.0.31:3141/root/pypi/+simple/pip/` → devpi PyPI HTML index
  - `curl http://172.28.0.31:4873/-/ping` → verdaccio JSON `{}`
- [ ] When a cache service is unreachable (e.g. stopped), the dashboard build falls back to public upstream and still completes.

### Functional Behaviour (infinito-nexus side)

- [ ] `web-app-dashboard` Dockerfile declares `ARG INFINITO_CACHE_APT_PROXY`, `INFINITO_CACHE_PIP_INDEX_URL`, `INFINITO_CACHE_NPM_REGISTRY` with empty defaults.
- [ ] Each `RUN` step that does network I/O conditionally writes the cache config when the corresponding ARG is non-empty, and removes the cache-specific config files at the end of the same RUN so the resulting image is unchanged from a no-cache build.
- [ ] No build artefact (image layer, env var, file) carries the cache URL into the runtime image.

### Failure Modes

- [ ] If a cache service fails to start, the e2e fails fast with a clear message (`cache-<name> not healthy after <timeout>s`) instead of silently degrading.
- [ ] If a cache service is healthy but returns 5xx for a specific package, the build surfaces the upstream URL in the failure log (no silent fallback that hides drift).
- [ ] Wiping `state/e2e/cache-{registry,package}/` after a successful run does not break the next run; the cache simply rebuilds on cold path.
- [ ] Cache size enforcement keeps the on-disk volume at or below the configured limit over many consecutive runs (`CACHE_REGISTRY_MAX_SIZE` for cache-registry, per-process caps inside cache-package summing to `CACHE_PACKAGE_MAX_SIZE`).

### Cross-Repo Coordination

- [ ] The deployer-side change (this requirement) and the matching infinito-nexus PR are reviewed and merged as a pair (use cross-linked PR descriptions).
- [ ] The infinito-nexus PR description references this requirement file path (`docs/requirements/018-local-build-cache-infrastructure.md`).
- [ ] Each side passes its own CI without depending on the other being deployed: deployer CI may run with cache-package present but unused; infinito-nexus CI may run a build with empty cache args.

### Documentation

- [ ] Each cache component has a `README.md` documenting: image and version (or build context for cache-package), upstream URL(s), exposed endpoint(s), consumer wiring, persistence path, cache size bound and how it is enforced, why this implementation was chosen.
- [ ] The Dockerfile-side wiring (build args) is documented in the `web-app-dashboard` role's `README.md` in infinito-nexus, with a link back to this requirement.

### Security and Quality

- [ ] No cache service is reachable from outside the docker-compose network (no host port published).
- [ ] No cache service requires authentication credentials.
- [ ] All new shell scripts pass `make lint` (deployer side) and the equivalent linter in infinito-nexus.
- [ ] `make e2e-dashboard-wipe-caches` runs successfully from a clean checkout.

## Out of Scope

- Production deployments and deployments to non-test targets.
- Caching for additional package managers (cargo, gem, go modules, composer, …). Adding them later MUST extend `cache-package` (a fourth supervised process inside the same container), not introduce a third compose container.
- A clustered or shared cache reachable from multiple developer machines.
- Persisting caches across CI workflow runs via `actions/cache@v4` — fresh GitHub-Actions runners pull cold every CI invocation. This may be added later as a separate optimisation; not required by this requirement.
- Mirroring registries other than docker.io (ghcr.io, quay.io, …) in `cache-registry`. Separate requirement if needed.

## Cross-References

- [014 - E2E Test: Deploy web-app-dashboard to a Local Container](014-e2e-dashboard-deploy.md)
- [015 - Image Build From Local Source](015-image-build-from-local-source.md)
- Commit `65eec5eb` (`fix(e2e): switch from rpardini CONNECT proxy to registry:2 docker.io mirror`) — initial `cache-registry` implementation that this requirement formalises and extends.
- Pending: infinito-nexus PR #TBD adding `INFINITO_CACHE_*` propagation through `roles/web-app-dashboard/templates/compose.yml.j2` `build.args:`.
- Pending: port-ui PR #TBD (https://github.com/kevinveenbirkenbach/port-ui) adding `ARG INFINITO_CACHE_*` declarations + conditional cache-config snippets to its top-level `Dockerfile`. Same pattern applies to other apps that own their own Dockerfile in upstream repos.
