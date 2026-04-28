# cache-registry: registry:2 docker.io pull-through cache wrapped in
# s6-overlay v3 so a periodic GC service can keep on-disk size below
# CACHE_REGISTRY_MAX_SIZE without external supervision.
# See docs/requirements/018-local-build-cache-infrastructure.md.
FROM registry:2

ARG S6_OVERLAY_VERSION=3.2.0.2
ENV S6_VERBOSITY=1 \
    S6_KEEP_ENV=1 \
    S6_BEHAVIOUR_IF_STAGE2_FAILS=2

# bash + coreutils give the GC script a portable du/find/stat (busybox's
# du lacks -b on alpine). xz + tar are needed for the s6-overlay install.
RUN apk add --no-cache bash coreutils curl tar xz

# s6-overlay v3 (split tarball: noarch + arch).
RUN curl -fsSL "https://github.com/just-containers/s6-overlay/releases/download/v${S6_OVERLAY_VERSION}/s6-overlay-noarch.tar.xz" \
       | tar -C / -Jxpf - \
 && curl -fsSL "https://github.com/just-containers/s6-overlay/releases/download/v${S6_OVERLAY_VERSION}/s6-overlay-x86_64.tar.xz" \
       | tar -C / -Jxpf -

COPY gc.sh                 /usr/local/bin/cache-registry-gc
COPY s6-rc.d/              /etc/s6-overlay/s6-rc.d/

RUN chmod +x /usr/local/bin/cache-registry-gc \
 && find /etc/s6-overlay/s6-rc.d -type f \( -name run -o -name up \) -exec chmod +x {} +

EXPOSE 5000

ENTRYPOINT ["/init"]
