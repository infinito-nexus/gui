ARG PLAYWRIGHT_BASE=mcr.microsoft.com/playwright:v1.55.1-jammy
FROM ${PLAYWRIGHT_BASE}

# Install the docker CLI + compose plugin so the dashboard E2E spec can
# `docker compose exec ssh-password curl ...` against the deployed app even
# when Playwright runs inside a container instead of on the host.
RUN apt-get update \
  && apt-get install -y --no-install-recommends docker.io docker-compose-v2 \
  && rm -rf /var/lib/apt/lists/*
