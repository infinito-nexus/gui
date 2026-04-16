#!/usr/bin/env bash
set -euo pipefail

if [ ! -s /etc/machine-id ]; then
  systemd-machine-id-setup
fi

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

cat > /etc/dnsmasq.conf <<EOF
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
cat > /etc/systemd/system/docker.service.d/dns-dep.conf <<'EOF'
[Unit]
After=dnsmasq.service
Wants=dnsmasq.service
EOF

exec /usr/lib/systemd/systemd
