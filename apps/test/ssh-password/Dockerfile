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
    iproute2 \
    iputils \
    iptables-nft \
    make \
    openssh \
    python \
    python-docker \
    python-packaging \
    python-pip \
    python-requests \
    python-yaml \
    sudo \
    systemd \
  && useradd -m -s /bin/bash deploy \
  && echo "deploy:deploy" | chpasswd \
  && echo "deploy ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers \
  && install -d -m 0755 /etc/docker /usr/local/bin /run/systemd/system /etc/systemd/system/multi-user.target.wants \
  && printf '{\n  "storage-driver": "vfs",\n  "dns": ["1.1.1.1", "8.8.8.8"]\n}\n' > /etc/docker/daemon.json \
  && ln -sf /usr/bin/python3 /usr/local/bin/python3 \
  && ssh-keygen -A \
  && ln -sf /usr/lib/systemd/system/sshd.service /etc/systemd/system/multi-user.target.wants/sshd.service \
  && ln -sf /usr/lib/systemd/system/docker.service /etc/systemd/system/multi-user.target.wants/docker.service \
  && ln -sf /usr/lib/systemd/system/dnsmasq.service /etc/systemd/system/multi-user.target.wants/dnsmasq.service \
  && rm -rf /var/cache/pacman/pkg/*

# Disable iptables management via systemd drop-in rather than daemon.json,
# because the Ansible `sys-svc-container` role rewrites daemon.json during
# deploy. The dockerd CLI flag survives that rewrite and prevents inner
# Docker from flushing the shared nf_tables ruleset, which would otherwise
# disrupt outer SSH TCP connections to this DinD container.
RUN install -d -m 0755 /etc/systemd/system/docker.service.d \
 && printf '[Service]\nExecStart=\nExecStart=/usr/bin/dockerd -H fd:// --containerd=/run/containerd/containerd.sock --iptables=false\n' \
    > /etc/systemd/system/docker.service.d/no-iptables.conf

# Prevent pacman -Syu (run by Ansible's update-pacman role) from upgrading
# openssh, which would restart sshd and drop the Ansible SSH ControlMaster
# mid-deploy.
RUN sed -i 's|^#IgnorePkg.*|IgnorePkg = openssh|' /etc/pacman.conf \
 && grep -q '^IgnorePkg = openssh' /etc/pacman.conf

# Pre-seed /etc/ssh/sshd_config to match exactly what the nexus
# sys-svc-sshd role will render (with SYS_SVC_SSHD_PASSWORD_AUTHENTICATION=true).
# This keeps Ansible's `template` task idempotent and prevents the
# `sshd restart` handler from firing mid-deploy and dropping SSH.
COPY sshd_config /etc/ssh/sshd_config
RUN chown root:root /etc/ssh/sshd_config && chmod 0644 /etc/ssh/sshd_config

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 22
CMD ["/entrypoint.sh"]
