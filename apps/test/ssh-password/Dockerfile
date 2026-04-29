FROM archlinux:latest

ENV container=docker
STOPSIGNAL SIGRTMIN+3

RUN pacman -Syu --noconfirm --needed \
    ca-certificates \
    curl \
    dnsmasq \
    docker \
    docker-buildx \
    docker-compose \
    fuse-overlayfs \
    gcc \
    git \
    inetutils \
    iproute2 \
    iputils \
    iptables-nft \
    make \
    nix \
    openssh \
    python \
    python-docker \
    python-packaging \
    python-pip \
    python-requests \
    python-yaml \
    rsync \
    sudo \
    systemd \
  && useradd -m -s /bin/bash deploy \
  && useradd -m -s /bin/bash perfmask \
  && echo "deploy:deploy" | chpasswd \
  && echo "perfmask:PerfMaskSecret-9a8b7c6d5e4f3g2h" | chpasswd \
  && echo "deploy ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers \
  && echo "perfmask ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers \
  && install -d -m 0755 /etc/docker /usr/local/bin /run/systemd/system /etc/systemd/system/multi-user.target.wants /etc/systemd/system/sshd.service.d \
  && printf '{\n  "storage-driver": "vfs",\n  "dns": ["1.1.1.1", "8.8.8.8"],\n  "insecure-registries": ["infinito-deployer-cache-registry:5000"]\n}\n' > /etc/docker/daemon.json \
  && ln -sf /usr/bin/python3 /usr/local/bin/python3 \
  && ssh-keygen -A \
  && ln -sf /usr/lib/systemd/system/sshd.service /etc/systemd/system/multi-user.target.wants/sshd.service \
  && ln -sf /usr/lib/systemd/system/docker.service /etc/systemd/system/multi-user.target.wants/docker.service \
  && ln -sf /usr/lib/systemd/system/dnsmasq.service /etc/systemd/system/multi-user.target.wants/dnsmasq.service \
  && rm -rf /var/cache/pacman/pkg/*

# Keep the inner dockerd networking flags on the systemd unit rather than
# daemon.json because the Ansible `sys-svc-container` role rewrites
# daemon.json during deploy. These CLI flags survive that rewrite, prevent
# dockerd from mutating the outer container's shared nf_tables state, and
# avoid IPv6 sysctl writes that fail against Docker's read-only /proc/sys
# mount inside this DinD test target.
RUN install -d -m 0755 /etc/systemd/system/docker.service.d \
 && printf '[Service]\nEnvironment="HTTP_PROXY=http://172.28.0.31:3142"\nExecStart=\nExecStart=/usr/bin/dockerd -H fd:// --containerd=/run/containerd/containerd.sock --iptables=false --ipv6=true --fixed-cidr-v6=fd42:2::/80 --ip-forward=false --ip6tables=false --default-network-opt bridge=com.docker.network.enable_ipv6=true --registry-mirror=http://infinito-deployer-cache-registry:5000\n' \
    > /etc/systemd/system/docker.service.d/no-iptables.conf

# Why `--registry-mirror=` (CLI flag) instead of HTTP_PROXY env or
# containerd hosts.toml:
#   - HTTP_PROXY pointing at cache-REGISTRY broke before because the
#     registry only allow-lists docker registry hostnames and rejects
#     everything else, so `RUN apt-get` / `pip install` / `npm install`
#     exited 100 (CI run 25006674718). HTTP_PROXY pointing at
#     cache-PACKAGE (req 018; apt-cacher-ng on 172.28.0.31:3142) does
#     not have that limitation — acng's `PassThroughPattern: .*`
#     lets it cache deb.debian.org / ubuntu mirrors AND proxy
#     arbitrary HTTPS via CONNECT, so apt traffic from build
#     containers no longer needs raw internet from the inner DinD.
#   - We deliberately set HTTP_PROXY only (not HTTPS_PROXY): apt
#     mirrors are HTTP and we want them cached; pip / npm use HTTPS
#     to pypi.org / registry.npmjs.org and going through acng's
#     CONNECT tunnel adds latency without caching benefit.
#   - --registry-mirror still uses the cache-REGISTRY because dockerd
#     does not route registry pulls through HTTP_PROXY anyway.
#   - containerd `hosts.toml` requires `containerd-snapshotter` mode,
#     which is incompatible with this DinD target's `vfs` storage
#     driver. fuse-overlayfs / overlayfs both fail in nested DinD
#     here (overlay mount returns EINVAL).
#   - daemon.json `registry-mirrors` is rewritten by the Ansible
#     sys-svc-container role during deploy. CLI flags on the systemd
#     unit survive that rewrite the same way the network flags above
#     do.
#
# Trade-off: this only caches docker.io. ghcr.io / quay.io / etc. go
# direct from the inner DinD. That is acceptable because docker.io is
# the only registry that has hit rate limits or upstream IPv6 issues
# on GitHub-Actions runners in our CI history (runs 24943727751,
# 24968576122, 25000929344, 25006674718 all on docker.io content);
# ghcr.io has never been a problem.

# Prevent pacman -Syu (run by Ansible's update-pacman role) from upgrading
# openssh while the E2E target is live.
RUN sed -i 's|^#IgnorePkg.*|IgnorePkg = openssh|' /etc/pacman.conf \
 && grep -q '^IgnorePkg = openssh' /etc/pacman.conf

# Keep the test target's sshd_config byte-for-byte aligned with the core image
# template so the sys-svc-sshd role stays idempotent during deploys.
COPY sshd_config /etc/ssh/sshd_config
RUN chown root:root /etc/ssh/sshd_config && chmod 0644 /etc/ssh/sshd_config

# Preserve password authentication for this dedicated E2E target even though
# the core image template hardens PasswordAuthentication to "no". The service
# override applies to the daemon process itself, while the on-disk config stays
# aligned with the template and therefore does not trigger a mid-deploy restart.
COPY sshd-password-auth.conf /etc/systemd/system/sshd.service.d/password-auth.conf
RUN chown root:root /etc/systemd/system/sshd.service.d/password-auth.conf \
 && chmod 0644 /etc/systemd/system/sshd.service.d/password-auth.conf

COPY pacman-wrapper.sh /usr/local/bin/pacman
RUN chmod +x /usr/local/bin/pacman

COPY timeout-wrapper.sh /usr/local/bin/timeout
RUN chmod +x /usr/local/bin/timeout

COPY hostnamectl-wrapper.sh /usr/local/bin/hostnamectl
RUN chmod +x /usr/local/bin/hostnamectl

COPY ssh-keyscan-wrapper.sh /usr/local/bin/ssh-keyscan
RUN chmod +x /usr/local/bin/ssh-keyscan

COPY git-wrapper.sh /usr/local/bin/git
RUN mv /usr/bin/git /usr/bin/git.actual \
 && chmod +x /usr/local/bin/git \
 && ln -sf /usr/local/bin/git /usr/bin/git

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 22
CMD ["/entrypoint.sh"]
