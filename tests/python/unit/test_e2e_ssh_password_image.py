import codecs
import json
import re
import unittest
from pathlib import Path


class TestE2ESshPasswordImage(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        repo_root = Path(__file__).resolve().parents[3]
        cls.dockerfile = (
            repo_root / "apps" / "test" / "ssh-password" / "Dockerfile"
        ).read_text(encoding="utf-8")

    def _extract_printf_payload(self, target_path: str) -> str:
        pattern = re.compile(
            rf"printf '(.+?)'\s*(?:\\\s*)?> {re.escape(target_path)}",
            re.DOTALL,
        )
        match = pattern.search(self.dockerfile)
        self.assertIsNotNone(match, f"missing printf payload for {target_path}")
        encoded_payload = match.group(1)
        return codecs.decode(encoded_payload, "unicode_escape")

    def test_ssh_password_image_includes_rsync_for_repeat_deploy_backups(self) -> None:
        self.assertIn("\n    rsync \\\n", self.dockerfile)

    def test_ssh_password_image_configures_inner_docker_daemon_defaults(self) -> None:
        daemon_json = self._extract_printf_payload("/etc/docker/daemon.json")

        # Per req 018, daemon.json also seeds insecure-registries with the
        # cache-registry hostname so docker.io pulls inside the inner DinD
        # can use the local pull-through cache over plain HTTP.
        self.assertEqual(
            json.loads(daemon_json),
            {
                "storage-driver": "vfs",
                "dns": ["1.1.1.1", "8.8.8.8"],
                "insecure-registries": [
                    "infinito-deployer-cache-registry:5000"
                ],
            },
        )

    def test_ssh_password_image_uses_ipv6_safe_dockerd_service_flags(self) -> None:
        drop_in = self._extract_printf_payload(
            "/etc/systemd/system/docker.service.d/no-iptables.conf"
        )

        self.assertIn("[Service]\n", drop_in)
        self.assertIn("ExecStart=\n", drop_in)
        self.assertIn(
            "ExecStart=/usr/bin/dockerd -H fd:// --containerd=/run/containerd/containerd.sock",
            drop_in,
        )
        self.assertIn("--iptables=false", drop_in)
        self.assertIn("--ipv6=true", drop_in)
        self.assertIn("--fixed-cidr-v6=fd42:2::/80", drop_in)
        self.assertIn("--ip-forward=false", drop_in)
        self.assertIn("--ip6tables=false", drop_in)
        self.assertIn(
            "--default-network-opt bridge=com.docker.network.enable_ipv6=true",
            drop_in,
        )
        # HTTP_PROXY env routes inner-DinD build apt traffic through the
        # cache-package's apt-cacher-ng on 172.28.0.31:3142 so port-ui's
        # Dockerfile `apt-get install nodejs npm` no longer relies on
        # raw deb.debian.org reachability from nested DinD (req 018).
        self.assertIn(
            'Environment="HTTP_PROXY=http://172.28.0.31:3142"',
            drop_in,
        )


if __name__ == "__main__":
    unittest.main()
