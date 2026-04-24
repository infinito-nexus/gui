#!/usr/bin/env bash
set -euo pipefail

if [ ! -s /etc/machine-id ]; then
  systemd-machine-id-setup
fi

# Docker injects /etc/hosts as a dedicated mount that rejects the atomic
# rename strategy used by Ansible's file-editing modules. Replace it with a
# regular file so the hostname role can update host mappings during deploy.
HOSTS_BACKUP="/run/infinito-etc-hosts"
cp /etc/hosts "${HOSTS_BACKUP}" 2>/dev/null || true
umount /etc/hosts 2>/dev/null || true
if [ ! -e /etc/hosts ] && [ -s "${HOSTS_BACKUP}" ]; then
  cp "${HOSTS_BACKUP}" /etc/hosts
fi

# Rehydrate a fresh writable repo workspace from the read-only host cache so
# the dedicated E2E target can run hermetically and faster. This is an
# infrastructure optimization, not the root-cause fix for broken Git/DNS/TLS
# connectivity.
if [ -d /opt/e2e/repo-seeds ] && [ -n "$(find /opt/e2e/repo-seeds -mindepth 1 -print -quit 2>/dev/null)" ]; then
  rm -rf /opt/Repositories
  install -d -m 0755 /opt/Repositories
  cp -a /opt/e2e/repo-seeds/. /opt/Repositories/
fi

# Rewrite direct GitHub clone URLs for locally mirrored repos so pkgmgr-style
# HTTPS/SSH clones can stay inside the mounted E2E mirror cache when that
# optimization is enabled.
if [ -d /opt/e2e/repo-mirrors ] && [ -n "$(find /opt/e2e/repo-mirrors -name '*.git' -print -quit 2>/dev/null)" ]; then
  cat >/etc/gitconfig <<'EOF'
[safe]
	directory = *
EOF

  while IFS= read -r mirror_repo; do
    rel_path="${mirror_repo#/opt/e2e/repo-mirrors/}"
    provider="${rel_path%%/*}"
    repo_with_owner="${rel_path#*/}"
    repo_no_git="${repo_with_owner%.git}"
    mirror_url="file:///opt/e2e/repo-mirrors/${rel_path}"

    {
      printf '[url "%s"]\n' "${mirror_url}"
      printf '\tinsteadOf = https://%s/%s\n' "${provider}" "${repo_no_git}"
      printf '\tinsteadOf = https://%s/%s.git\n' "${provider}" "${repo_no_git}"
      printf '\tinsteadOf = ssh://git@%s/%s\n' "${provider}" "${repo_no_git}"
      printf '\tinsteadOf = ssh://git@%s/%s.git\n' "${provider}" "${repo_no_git}"
      printf '\tinsteadOf = git@%s:%s\n' "${provider}" "${repo_no_git}"
      printf '\tinsteadOf = git@%s:%s.git\n' "${provider}" "${repo_no_git}"
    } >>/etc/gitconfig
  done < <(find /opt/e2e/repo-mirrors -type d -name '*.git' | sort)
fi

# The optional image cache is consumed lazily by docker-wrapper.sh on demand.
# Preloading multi-GB archives during boot made the healthcheck time out and
# turned a cache optimization into a startup blocker.

# Inner Docker runs with "iptables": false to avoid flushing the shared
# nf_tables ruleset and disrupting the outer SSH TCP connection.
# Pre-seed the NAT/FORWARD rules so inner containers can still reach
# the internet. Nexus-managed docker networks allocate out of the RFC1918
# ranges 172.16.0.0/12 and 192.168.0.0/16 (see networks.local.subnet_prefix),
# so both must be masqueraded for outbound traffic from mailu/etc. to
# have a valid return route.
iptables -t nat -A POSTROUTING -s 172.16.0.0/12 ! -o lo -j MASQUERADE 2>/dev/null || true
iptables -t nat -A POSTROUTING -s 192.168.0.0/16 ! -o lo -j MASQUERADE 2>/dev/null || true
iptables -t nat -A POSTROUTING -s 10.0.0.0/8 ! -o lo -j MASQUERADE 2>/dev/null || true
iptables -A FORWARD -j ACCEPT 2>/dev/null || true

# Detect eth0 IP and render dnsmasq config so inner docker containers can
# resolve *.infinito.localhost (served by openresty in host-network mode)
# to this DinD container's own address.
ETH0_IP="$(ip -4 -o addr show eth0 | awk '{print $4}' | cut -d/ -f1)"
if [ -z "${ETH0_IP}" ]; then
  echo "✖ entrypoint: could not determine eth0 IP" >&2
  exit 1
fi

cat >/etc/dnsmasq.conf <<EOF
# Rendered by entrypoint.sh for DinD infinito.localhost resolution.
interface=eth0
bind-interfaces
no-resolv
no-hosts
server=1.1.1.1
server=8.8.8.8
address=/infinito.localhost/${ETH0_IP}
EOF

# Ensure docker.service waits for dnsmasq.service so inner containers
# spawned during early deploy can resolve infinito.localhost.
install -d -m 0755 /etc/systemd/system/docker.service.d
cat >/etc/systemd/system/docker.service.d/dns-dep.conf <<'EOF'
[Unit]
After=dnsmasq.service
Wants=dnsmasq.service
EOF

exec /usr/lib/systemd/systemd
