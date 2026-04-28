# cache-registry

`registry:2` configured as a docker.io pull-through cache, wrapped in
s6-overlay v3 so a periodic GC service can keep on-disk size below
`CACHE_REGISTRY_MAX_SIZE` (default 16 GB).

## Endpoint

- HTTP: `http://infinito-deployer-cache-registry:5000/`
- Static IP on the outer compose network: `172.28.0.30`
- Upstream: `https://registry-1.docker.io`

## Consumers

The inner Docker daemon inside `ssh-password` is configured with
`--registry-mirror=http://infinito-deployer-cache-registry:5000` (set on
the systemd unit, see `apps/test/ssh-password/Dockerfile`). Every
docker.io pull from build containers spawned inside that DinD goes
through this cache.

ghcr.io / quay.io / etc. are NOT cached and pull direct.

**Why hostname for `--registry-mirror=` but static IP for the package
caches?** The dockerd that holds the `--registry-mirror=` flag runs on
ssh-password's outer interface, where compose-network DNS resolves the
hostname. The package-cache build-args, on the other hand, are consumed
inside the inner-DinD's build containers which do not share that DNS
namespace — so those use the static IP `172.28.0.31` instead. Don't
"fix" the registry-mirror to use an IP; the asymmetry is intentional.

## Persistence

- Bind mount: `state/e2e/cache-registry/` → `/var/lib/registry/`.
- Owner inside the container: the registry image's `registry` user.
- Wipe: `make e2e-dashboard-wipe-caches`.

## Size enforcement (GC)

A second s6-rc longrun service (`gc`) runs `cache-registry-gc` (the
script under `files/gc.sh`). It checks `du -sb /var/lib/registry/docker`
every 24 h normally, every 30 min when over budget, and when above the
cap it stops the registry service via `s6-svc -wD`, wipes the on-disk
content, and starts the registry again.

Why a wipe instead of `registry garbage-collect`?
The upstream `garbage-collect` only deletes blobs whose manifests are
gone. In pull-through proxy mode the proxy keeps every manifest it has
served, so `garbage-collect` deletes nothing. A clean wipe is the only
practical size-control mechanism, and the proxy re-fetches on the next
pull. The cycle is brief because s6 supervises the restart.

The cap is read from the env var `CACHE_REGISTRY_MAX_SIZE` (suffixes
`g`/`m`/`k`/`b` accepted; default `16g`) which compose forwards from
`docker-compose.yml`.

## Build context

`docker-compose.yml`'s `cache-registry` service builds this directory
on first `docker compose --profile test up`. Override at build-time:

- `S6_OVERLAY_VERSION` (default `3.2.0.2`)
