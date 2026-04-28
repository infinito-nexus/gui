# cache-package: single container bundling apt-cacher-ng + devpi-server +
# verdaccio under s6-overlay v3 supervision. Serves the e2e build's
# `RUN apt-get` / `pip install` / `npm install` from a local pull-through
# cache so repeated runs do not re-fetch the same packages from public
# upstreams. See docs/requirements/018-local-build-cache-infrastructure.md.
FROM debian:trixie-slim

ARG S6_OVERLAY_VERSION=3.2.0.2
ENV S6_VERBOSITY=1 \
    S6_KEEP_ENV=1 \
    S6_BEHAVIOUR_IF_STAGE2_FAILS=2 \
    DEBIAN_FRONTEND=noninteractive

# System packages: apt-cacher-ng for apt; nodejs+npm for verdaccio;
# python3-venv + pip for devpi-server. xz-utils + curl for s6-overlay
# tarball install.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
        apt-cacher-ng \
        ca-certificates \
        curl \
        nodejs \
        npm \
        python3 \
        python3-venv \
        python3-pip \
        xz-utils \
 && rm -rf /var/lib/apt/lists/*

# s6-overlay v3 (split tarball: noarch + arch).
RUN curl -fsSL "https://github.com/just-containers/s6-overlay/releases/download/v${S6_OVERLAY_VERSION}/s6-overlay-noarch.tar.xz" \
       | tar -C / -Jxpf - \
 && curl -fsSL "https://github.com/just-containers/s6-overlay/releases/download/v${S6_OVERLAY_VERSION}/s6-overlay-x86_64.tar.xz" \
       | tar -C / -Jxpf -

# devpi-server in its own venv so it does not collide with system python.
RUN python3 -m venv /opt/devpi \
 && /opt/devpi/bin/pip install --no-cache-dir 'devpi-server>=6.0,<7.0' \
 && ln -s /opt/devpi/bin/devpi-server /usr/local/bin/devpi-server \
 && ln -s /opt/devpi/bin/devpi-init   /usr/local/bin/devpi-init

# verdaccio via npm global. Pin major version so reproducible.
RUN npm install -g --no-audit --no-fund verdaccio@6 \
 && npm cache clean --force \
 && rm -rf /root/.npm

# Service users for each cached process. devpi/verdaccio chosen so the
# uid stays stable across image rebuilds; apt-cacher-ng's uid is created
# by its package install.
RUN useradd -r -s /usr/sbin/nologin -d /state/cache-package/pip devpi \
 && useradd -r -s /usr/sbin/nologin -d /state/cache-package/npm verdaccio

# Per-tool config files copied in below; supervisor structure under
# /etc/s6-overlay/s6-rc.d/.
COPY configs/acng.conf            /etc/apt-cacher-ng/acng.conf
COPY configs/verdaccio.yaml       /etc/verdaccio/config.yaml
COPY s6-rc.d/                     /etc/s6-overlay/s6-rc.d/
COPY entrypoint.sh                /entrypoint.sh
COPY gc.sh                        /usr/local/bin/cache-package-gc

# bash + coreutils give the GC script a portable du / awk / case (the
# script uses associative arrays and `[[`).
RUN apt-get update \
 && apt-get install -y --no-install-recommends bash coreutils \
 && rm -rf /var/lib/apt/lists/* \
 && chmod +x /entrypoint.sh /usr/local/bin/cache-package-gc \
 && find /etc/s6-overlay/s6-rc.d -type f \( -name run -o -name up \) -exec chmod +x {} +

EXPOSE 3141 3142 4873

# /init is s6-overlay's PID 1; we wrap it with our entrypoint so the
# /state/cache-package/{apt,pip,npm} subdirs get created and chowned
# (idempotent) and devpi-init runs once before the supervisor starts.
ENTRYPOINT ["/entrypoint.sh"]
CMD ["/init"]
