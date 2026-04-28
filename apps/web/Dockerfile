# ---- deps ----
FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS deps
# Optional pull-through cache endpoint (req 018). Empty default leaves
# npm pointed at the public registry. The e2e harness sets this via
# compose build.args so npm ci hits cache-package's verdaccio mirror.
ARG INFINITO_CACHE_NPM_REGISTRY=""
WORKDIR /app
COPY package.json package-lock.json* /app/
RUN if [ -n "$INFINITO_CACHE_NPM_REGISTRY" ]; then \
        npm config set registry "$INFINITO_CACHE_NPM_REGISTRY"; \
    fi \
 && npm ci \
 && rm -f /root/.npmrc /usr/local/etc/npmrc

# ---- build ----
FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS builder
WORKDIR /app
ARG NEXT_PUBLIC_API_BASE_URL
ARG NEXT_PUBLIC_API_STREAM_BASE_URL
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}
ENV NEXT_PUBLIC_API_STREAM_BASE_URL=${NEXT_PUBLIC_API_STREAM_BASE_URL}
COPY --from=deps /app/node_modules /app/node_modules
COPY . /app
RUN npm run build

# ---- runtime (standalone) ----
FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS runner
WORKDIR /app
ARG NEXT_PUBLIC_API_BASE_URL
ARG NEXT_PUBLIC_API_STREAM_BASE_URL
ENV NODE_ENV=production
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}
ENV NEXT_PUBLIC_API_STREAM_BASE_URL=${NEXT_PUBLIC_API_STREAM_BASE_URL}

RUN addgroup -S -g 10005 infinito-web \
 && adduser -S -D -H -u 10005 -G infinito-web infinito-web

# Next.js standalone output
COPY --from=builder --chown=10005:10005 /app/.next/standalone /app/
COPY --from=builder --chown=10005:10005 /app/.next/static /app/.next/static
COPY --from=builder --chown=10005:10005 /app/public /app/public

USER 10005:10005

EXPOSE 3000
CMD ["node", "server.js"]
