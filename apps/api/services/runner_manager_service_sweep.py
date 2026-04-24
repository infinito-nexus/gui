from __future__ import annotations

import importlib

from fastapi import HTTPException

from .runner_manager_service_support import (
    ACTIVE_JOB_STATUSES,
    RUNNER_SECRETS_DIR,
    RUNNER_SECRETS_READY_FILE,
    RUNNER_SECRET_VOLUME_PREFIX,
    TERMINAL_JOB_STATUSES,
)


def _root():
    return importlib.import_module("services.runner_manager_service")


class RunnerManagerServiceSweepMixin:
    def __init__(self) -> None:
        root = _root()
        root.safe_mkdir(root.jobs_root())
        self._audit_logs = root.AuditLogService()
        if not root.env_bool("RUNNER_MANAGER_ORPHAN_SWEEP_ENABLED", True):
            return
        self.sweep_orphans()
        interval = self._orphan_sweep_interval_seconds()
        if interval > 0:
            root.threading.Thread(
                target=self._orphan_sweep_loop,
                kwargs={"interval_seconds": interval},
                daemon=True,
                name="runner-manager-orphan-sweep",
            ).start()

    def _orphan_sweep_interval_seconds(self) -> int:
        raw = str(
            _root().os.getenv("JOB_ORPHAN_SWEEP_INTERVAL_SECONDS") or "600"
        ).strip()
        try:
            return max(int(raw), 0)
        except ValueError:
            return 600

    def _job_retention_days(self) -> int:
        raw = str(_root().os.getenv("JOB_RETENTION_DAYS") or "7").strip()
        try:
            return max(int(raw), 1)
        except ValueError:
            return 7

    def _orphan_sweep_loop(self, *, interval_seconds: int) -> None:
        while True:
            _root().time.sleep(max(int(interval_seconds), 1))
            self.sweep_orphans()

    def _active_jobs(self) -> dict[str, dict[str, str]]:
        root = _root()
        active: dict[str, dict[str, str]] = {}
        for job_dir in sorted(
            root.jobs_root().iterdir() if root.jobs_root().exists() else []
        ):
            if not job_dir.is_dir():
                continue
            meta = root.load_json(job_dir / "job.json")
            status = str(meta.get("status") or "").strip().lower()
            if status not in ACTIVE_JOB_STATUSES:
                continue
            request = root.load_json(job_dir / "request.json")
            job_id = str(job_dir.name).strip()
            active[job_id] = {
                "workspace_id": str(request.get("workspace_id") or "").strip(),
                "network_name": str(
                    meta.get("network_name") or f"job-{job_id}"
                ).strip(),
                "secret_volume_name": str(
                    meta.get("secret_volume_name") or self._secret_volume_name(job_id)
                ).strip(),
            }
        return active

    def _docker_lines(self, *args: str) -> list[str]:
        root = _root()
        try:
            result = root.subprocess.run(
                [root.resolve_docker_bin(), *args],
                stdout=root.subprocess.PIPE,
                stderr=root.subprocess.DEVNULL,
                text=True,
                check=False,
            )
        except Exception:
            return []
        if result.returncode != 0:
            return []
        return [
            line.strip()
            for line in str(result.stdout or "").splitlines()
            if line.strip()
        ]

    def _load_yaml_mapping(self, path) -> dict[str, object]:
        root = _root()
        if not path.is_file():
            return {}
        try:
            data = root.load_workspace_yaml_document(
                path.read_text(encoding="utf-8", errors="replace")
            )
        except Exception:
            return {}
        return data if isinstance(data, dict) else {}

    def _secret_volume_name(self, job_id: str) -> str:
        return f"{RUNNER_SECRET_VOLUME_PREFIX}{str(job_id or '').strip()}"

    def _wait_for_container_running(
        self,
        container_name: str,
        *,
        timeout_seconds: float = 5.0,
    ) -> None:
        root = _root()
        deadline = root.time.monotonic() + max(float(timeout_seconds), 0.1)
        while root.time.monotonic() < deadline:
            result = root.subprocess.run(
                [
                    root.resolve_docker_bin(),
                    "inspect",
                    "-f",
                    "{{.State.Running}}",
                    container_name,
                ],
                stdout=root.subprocess.PIPE,
                stderr=root.subprocess.DEVNULL,
                text=True,
                check=False,
            )
            if result.returncode == 0 and result.stdout.strip().lower() == "true":
                return
            root.time.sleep(0.1)
        raise HTTPException(
            status_code=500,
            detail=f"runner container {container_name} did not become running in time",
        )

    def _bootstrap_runner_secrets(
        self,
        *,
        secret_volume_name: str,
        source_dir: str,
        image: str,
    ) -> None:
        root = _root()
        host_source_dir = root.resolve_host_mount_source(source_dir)
        script = f"""
set -euo pipefail
rm -f "{RUNNER_SECRETS_READY_FILE}"
for name in ssh_key ssh_password vault_password credentials.kdbx; do
  src="/infinito-source-secrets/${{name}}"
  dst="{RUNNER_SECRETS_DIR}/${{name}}"
  if [ ! -f "${{src}}" ]; then
    continue
  fi
  cp "${{src}}" "${{dst}}"
  chown 10002:10002 "${{dst}}"
  chmod 0400 "${{dst}}"
done
: > "{RUNNER_SECRETS_READY_FILE}"
chown 10002:10002 "{RUNNER_SECRETS_READY_FILE}"
chmod 0400 "{RUNNER_SECRETS_READY_FILE}"
""".strip()
        result = root.subprocess.run(
            [
                root.resolve_docker_bin(),
                "run",
                "--rm",
                "-v",
                f"{secret_volume_name}:{RUNNER_SECRETS_DIR}",
                "-v",
                f"{host_source_dir}:/infinito-source-secrets:ro",
                "--entrypoint",
                "/bin/sh",
                image,
                "-lc",
                script,
            ],
            stdout=root.subprocess.PIPE,
            stderr=root.subprocess.PIPE,
            text=True,
            check=False,
        )
        if result.returncode == 0:
            return
        detail = (result.stderr or result.stdout or "").strip() or "unknown error"
        raise HTTPException(
            status_code=500,
            detail=f"failed to seed runner secrets: {detail}",
        )

    def _find_compose_target_container(self, host: str) -> str | None:
        normalized = str(host or "").strip()
        if not normalized:
            return None
        service_matches = self._docker_lines(
            "ps",
            "--filter",
            f"label=com.docker.compose.service={normalized}",
            "--format",
            "{{.Names}}",
        )
        if service_matches:
            return service_matches[0]
        container_matches = self._docker_lines(
            "ps",
            "--filter",
            f"name=^/{normalized}$",
            "--format",
            "{{.Names}}",
        )
        if container_matches:
            return container_matches[0]
        return None

    def _connect_mode_a_targets(
        self, paths, network_name: str
    ) -> list[dict[str, object]]:
        root = _root()
        host_vars_dir = paths.job_dir / "host_vars"
        if not host_vars_dir.is_dir():
            return []

        targets: dict[str, set[str]] = {}
        for host_vars_path in sorted(host_vars_dir.glob("*.yml")):
            alias = str(host_vars_path.stem or "").strip()
            host_vars = self._load_yaml_mapping(host_vars_path)
            target_host = str(host_vars.get("ansible_host") or alias).strip()
            if not target_host:
                continue
            container_name = self._find_compose_target_container(target_host)
            if not container_name:
                continue
            aliases = targets.setdefault(container_name, set())
            aliases.add(target_host)
            if alias:
                aliases.add(alias)

        attachments: list[dict[str, object]] = []
        for container_name, aliases in sorted(targets.items()):
            cmd = [root.resolve_docker_bin(), "network", "connect"]
            for alias in sorted(aliases):
                cmd.extend(["--alias", alias])
            cmd.extend([network_name, container_name])
            result = root.subprocess.run(
                cmd,
                stdout=root.subprocess.PIPE,
                stderr=root.subprocess.PIPE,
                text=True,
                check=False,
            )
            if result.returncode != 0:
                raise HTTPException(
                    status_code=500,
                    detail=(
                        f"failed to attach compose-adjacent target {container_name} "
                        f"to {network_name}: {result.stderr.strip()}"
                    ),
                )
            attachments.append(
                {
                    "container_name": container_name,
                    "aliases": sorted(aliases),
                }
            )
        return attachments

    def _disconnect_mode_a_targets(self, meta: dict[str, object]) -> None:
        root = _root()
        network_name = str(meta.get("network_name") or "").strip()
        if not network_name:
            return
        raw_targets = meta.get("mode_a_targets")
        if not isinstance(raw_targets, list):
            return
        for raw_target in raw_targets:
            if not isinstance(raw_target, dict):
                continue
            container_name = str(raw_target.get("container_name") or "").strip()
            if not container_name:
                continue
            try:
                root.subprocess.run(
                    [
                        root.resolve_docker_bin(),
                        "network",
                        "disconnect",
                        "-f",
                        network_name,
                        container_name,
                    ],
                    stdout=root.subprocess.DEVNULL,
                    stderr=root.subprocess.DEVNULL,
                    text=True,
                    check=False,
                )
            except Exception:
                continue

    def _list_runner_container_names(self) -> list[str]:
        return self._docker_lines(
            "ps",
            "-a",
            "--filter",
            "label=infinito.deployer.role=job-runner",
            "--format",
            "{{.Names}}",
        )

    def _list_job_network_names(self) -> list[str]:
        return [
            name
            for name in self._docker_lines("network", "ls", "--format", "{{.Name}}")
            if name.startswith("job-")
        ]

    def _list_secret_volume_names(self) -> list[str]:
        return [
            name
            for name in self._docker_lines("volume", "ls", "--format", "{{.Name}}")
            if name.startswith(RUNNER_SECRET_VOLUME_PREFIX)
        ]

    def _list_ssh_egress_sidecars(self) -> list[str]:
        return [
            name
            for name in self._docker_lines("ps", "-a", "--format", "{{.Names}}")
            if name.startswith("ssh-egress-")
        ]

    def _emit_orphan_sweep_event(
        self,
        *,
        artifact_type: str,
        artifact_id: str,
        workspace_id: str | None = None,
    ) -> None:
        self._audit_logs.enqueue_system_event(
            path=f"/internal/orphan-sweep/{artifact_type}/{artifact_id}",
            workspace_id=workspace_id,
        )

    def _finished_at_unix(self, raw_value: object) -> float | None:
        text = str(raw_value or "").strip()
        if not text:
            return None
        if text.endswith("Z"):
            text = f"{text[:-1]}+00:00"
        try:
            return (
                _root()
                .datetime.fromisoformat(text)
                .astimezone(_root().timezone.utc)
                .timestamp()
            )
        except ValueError:
            return None

    def _sweep_stale_job_dirs(self, active_jobs: dict[str, dict[str, str]]) -> None:
        root = _root()
        cutoff = root.time.time() - (self._job_retention_days() * 86400)
        for job_dir in sorted(
            root.jobs_root().iterdir() if root.jobs_root().exists() else []
        ):
            if not job_dir.is_dir():
                continue
            job_id = str(job_dir.name).strip()
            if job_id in active_jobs:
                continue
            meta = root.load_json(job_dir / "job.json")
            status = str(meta.get("status") or "").strip().lower()
            if status not in TERMINAL_JOB_STATUSES:
                continue
            finished_at = self._finished_at_unix(meta.get("finished_at"))
            if finished_at is None or finished_at > cutoff:
                continue
            request = root.load_json(job_dir / "request.json")
            root.shutil.rmtree(job_dir, ignore_errors=True)
            self._emit_orphan_sweep_event(
                artifact_type="job-dir",
                artifact_id=job_id,
                workspace_id=str(request.get("workspace_id") or "").strip() or None,
            )

    def sweep_orphans(self) -> None:
        root = _root()
        active_jobs = self._active_jobs()
        active_job_ids = set(active_jobs)
        active_networks = {
            details["network_name"]
            for details in active_jobs.values()
            if str(details.get("network_name") or "").strip()
        }
        active_secret_volumes = {
            details["secret_volume_name"]
            for details in active_jobs.values()
            if str(details.get("secret_volume_name") or "").strip()
        }

        for container_name in self._list_runner_container_names():
            labels = root.inspect_container_labels(container_name)
            job_id = str(labels.get("infinito.deployer.job_id") or "").strip()
            if job_id in active_job_ids:
                continue
            root.remove_container(container_name)
            self._emit_orphan_sweep_event(
                artifact_type="runner-container",
                artifact_id=container_name,
                workspace_id=str(
                    labels.get("infinito.deployer.workspace_id") or ""
                ).strip()
                or None,
            )

        for network_name in self._list_job_network_names():
            if network_name in active_networks:
                continue
            root.remove_network(network_name)
            self._emit_orphan_sweep_event(
                artifact_type="job-network",
                artifact_id=network_name,
            )

        for sidecar_name in self._list_ssh_egress_sidecars():
            job_id = sidecar_name.removeprefix("ssh-egress-").strip()
            if job_id in active_job_ids:
                continue
            root.remove_container(sidecar_name)
            self._emit_orphan_sweep_event(
                artifact_type="ssh-egress-sidecar",
                artifact_id=sidecar_name,
            )

        for volume_name in self._list_secret_volume_names():
            if volume_name in active_secret_volumes:
                continue
            root.remove_volume(volume_name)
            self._emit_orphan_sweep_event(
                artifact_type="secret-volume",
                artifact_id=volume_name,
            )

        self._sweep_stale_job_dirs(active_jobs)
