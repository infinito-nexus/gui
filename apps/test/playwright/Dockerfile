ARG PLAYWRIGHT_BASE=mcr.microsoft.com/playwright:v1.55.1-jammy
FROM ${PLAYWRIGHT_BASE}

# Optional apt pull-through cache (req 018). Empty default leaves apt
# pointed at public Ubuntu mirrors. The e2e harness sets this via compose
# build.args so apt-get goes through cache-package's apt-cacher-ng.
ARG INFINITO_CACHE_APT_PROXY=""

# Install the docker CLI + compose plugin so the dashboard E2E spec can
# `docker compose exec ssh-password curl ...` against the deployed app even
# when Playwright runs inside a container instead of on the host.
RUN if [ -n "$INFINITO_CACHE_APT_PROXY" ]; then \
        printf 'Acquire::http::Proxy "%s";\n' "$INFINITO_CACHE_APT_PROXY" > /etc/apt/apt.conf.d/01infinito-cache; \
    fi \
  && apt-get update \
  && apt-get install -y --no-install-recommends docker.io docker-compose-v2 \
  && rm -rf /var/lib/apt/lists/* /etc/apt/apt.conf.d/01infinito-cache
