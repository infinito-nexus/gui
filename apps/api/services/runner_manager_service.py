from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timezone
import json
import os
import shutil
import subprocess
import threading
import time
from pathlib import Path
from typing import Any, Dict, Iterable, List

from fastapi import HTTPException

from api.schemas.deployment_job import DeploymentJobOut
from api.schemas.runner_manager import RunnerManagerJobSpec
from .audit_logs import AuditLogService
from .job_runner.container_runner import (
    build_container_command,
    create_tmpfs_volume,
    create_internal_network,
    inspect_container_labels,
    load_container_config,
    remove_container,
    remove_network,
    remove_volume,
    resolve_docker_bin,
    resolve_host_mount_source,
    stop_container,
)
from .job_runner.log_hub import _release_process_memory
from .job_runner.paths import job_paths, jobs_root
from .job_runner.persistence import load_json, write_meta
from .job_runner.config import env_bool
from .job_runner.runner import start_process, terminate_process_group
from .job_runner.util import safe_mkdir, utc_iso
from .workspaces.workspace_context import load_workspace_yaml_document

_ACTIVE_JOB_STATUSES = {"queued", "running"}
_TERMINAL_JOB_STATUSES = {"succeeded", "failed", "canceled"}
_RUNNER_SECRETS_DIR = "/run/secrets/infinito"
_RUNNER_SECRETS_READY_FILE = f"{_RUNNER_SECRETS_DIR}/.ready"
_RUNNER_SECRET_VOLUME_PREFIX = "infinito-job-secrets-"


def _with_group_add(extra_args: list[str], gid: int | str | None) -> list[str]:
    normalized = str(gid or "").strip()
    if not normalized:
        return list(extra_args)

    idx = 0
    while idx < len(extra_args):
        arg = str(extra_args[idx] or "").strip()
        if arg == "--group-add" and idx + 1 < len(extra_args):
            if str(extra_args[idx + 1] or "").strip() == normalized:
                return list(extra_args)
            idx += 1
        elif arg.startswith("--group-add="):
            if arg.split("=", 1)[1].strip() == normalized:
                return list(extra_args)
        idx += 1

    return [*extra_args, "--group-add", normalized]


class RunnerManagerService:
    def __init__(self) -> None:
        safe_mkdir(jobs_root())
        self._audit_logs = AuditLogService()
        if not env_bool("RUNNER_MANAGER_ORPHAN_SWEEP_ENABLED", True):
            return
        self.sweep_orphans()
        interval = self._orphan_sweep_interval_seconds()
        if interval > 0:
            threading.Thread(
                target=self._orphan_sweep_loop,
                kwargs={"interval_seconds": interval},
                daemon=True,
                name="runner-manager-orphan-sweep",
            ).start()

    def _orphan_sweep_interval_seconds(self) -> int:
        raw = str(os.getenv("JOB_ORPHAN_SWEEP_INTERVAL_SECONDS") or "600").strip()
        try:
            return max(int(raw), 0)
        except ValueError:
            return 600

    def _job_retention_days(self) -> int:
        raw = str(os.getenv("JOB_RETENTION_DAYS") or "7").strip()
        try:
            return max(int(raw), 1)
        except ValueError:
            return 7

    def _orphan_sweep_loop(self, *, interval_seconds: int) -> None:
        while True:
            time.sleep(max(int(interval_seconds), 1))
            self.sweep_orphans()

    def _active_jobs(self) -> dict[str, dict[str, str]]:
        active: dict[str, dict[str, str]] = {}
        for job_dir in sorted(jobs_root().iterdir() if jobs_root().exists() else []):
            if not job_dir.is_dir():
                continue
            meta = load_json(job_dir / "job.json")
            status = str(meta.get("status") or "").strip().lower()
            if status not in _ACTIVE_JOB_STATUSES:
                continue
            request = load_json(job_dir / "request.json")
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
        try:
            result = subprocess.run(
                [resolve_docker_bin(), *args],
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
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

    def _load_yaml_mapping(self, path: Path) -> dict[str, Any]:
        if not path.is_file():
            return {}
        try:
            data = load_workspace_yaml_document(
                path.read_text(encoding="utf-8", errors="replace")
            )
        except Exception:
            return {}
        return data if isinstance(data, dict) else {}

    def _secret_volume_name(self, job_id: str) -> str:
        return f"{_RUNNER_SECRET_VOLUME_PREFIX}{str(job_id or '').strip()}"

    def _wait_for_container_running(
        self,
        container_name: str,
        *,
        timeout_seconds: float = 5.0,
    ) -> None:
        deadline = time.monotonic() + max(float(timeout_seconds), 0.1)
        while time.monotonic() < deadline:
            result = subprocess.run(
                [
                    resolve_docker_bin(),
                    "inspect",
                    "-f",
                    "{{.State.Running}}",
                    container_name,
                ],
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                text=True,
                check=False,
            )
            if result.returncode == 0 and result.stdout.strip().lower() == "true":
                return
            time.sleep(0.1)
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
        host_source_dir = resolve_host_mount_source(source_dir)
        script = f"""
set -euo pipefail
rm -f "{_RUNNER_SECRETS_READY_FILE}"
for name in ssh_key ssh_password vault_password credentials.kdbx; do
  src="/infinito-source-secrets/${{name}}"
  dst="{_RUNNER_SECRETS_DIR}/${{name}}"
  if [ ! -f "${{src}}" ]; then
    continue
  fi
  cp "${{src}}" "${{dst}}"
  chown 10002:10002 "${{dst}}"
  chmod 0400 "${{dst}}"
done
: > "{_RUNNER_SECRETS_READY_FILE}"
chown 10002:10002 "{_RUNNER_SECRETS_READY_FILE}"
chmod 0400 "{_RUNNER_SECRETS_READY_FILE}"
""".strip()
        result = subprocess.run(
            [
                resolve_docker_bin(),
                "run",
                "--rm",
                "-v",
                f"{secret_volume_name}:{_RUNNER_SECRETS_DIR}",
                "-v",
                f"{host_source_dir}:/infinito-source-secrets:ro",
                "--entrypoint",
                "/bin/sh",
                image,
                "-lc",
                script,
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
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
        self,
        paths,
        network_name: str,
    ) -> list[dict[str, Any]]:
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

        attachments: list[dict[str, Any]] = []
        for container_name, aliases in sorted(targets.items()):
            cmd = [resolve_docker_bin(), "network", "connect"]
            for alias in sorted(aliases):
                cmd.extend(["--alias", alias])
            cmd.extend([network_name, container_name])
            result = subprocess.run(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
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

    def _disconnect_mode_a_targets(self, meta: Dict[str, Any]) -> None:
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
                subprocess.run(
                    [
                        resolve_docker_bin(),
                        "network",
                        "disconnect",
                        "-f",
                        network_name,
                        container_name,
                    ],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
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
            if name.startswith(_RUNNER_SECRET_VOLUME_PREFIX)
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
            return datetime.fromisoformat(text).astimezone(timezone.utc).timestamp()
        except ValueError:
            return None

    def _sweep_stale_job_dirs(self, active_jobs: dict[str, dict[str, str]]) -> None:
        cutoff = time.time() - (self._job_retention_days() * 86400)
        for job_dir in sorted(jobs_root().iterdir() if jobs_root().exists() else []):
            if not job_dir.is_dir():
                continue
            job_id = str(job_dir.name).strip()
            if job_id in active_jobs:
                continue
            meta = load_json(job_dir / "job.json")
            status = str(meta.get("status") or "").strip().lower()
            if status not in _TERMINAL_JOB_STATUSES:
                continue
            finished_at = self._finished_at_unix(meta.get("finished_at"))
            if finished_at is None or finished_at > cutoff:
                continue
            request = load_json(job_dir / "request.json")
            shutil.rmtree(job_dir, ignore_errors=True)
            self._emit_orphan_sweep_event(
                artifact_type="job-dir",
                artifact_id=job_id,
                workspace_id=str(request.get("workspace_id") or "").strip() or None,
            )

    def sweep_orphans(self) -> None:
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
            labels = inspect_container_labels(container_name)
            job_id = str(labels.get("infinito.deployer.job_id") or "").strip()
            if job_id in active_job_ids:
                continue
            remove_container(container_name)
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
            remove_network(network_name)
            self._emit_orphan_sweep_event(
                artifact_type="job-network",
                artifact_id=network_name,
            )

        for sidecar_name in self._list_ssh_egress_sidecars():
            job_id = sidecar_name.removeprefix("ssh-egress-").strip()
            if job_id in active_job_ids:
                continue
            remove_container(sidecar_name)
            self._emit_orphan_sweep_event(
                artifact_type="ssh-egress-sidecar",
                artifact_id=sidecar_name,
            )

        for volume_name in self._list_secret_volume_names():
            if volume_name in active_secret_volumes:
                continue
            remove_volume(volume_name)
            self._emit_orphan_sweep_event(
                artifact_type="secret-volume",
                artifact_id=volume_name,
            )

        self._sweep_stale_job_dirs(active_jobs)

    def create(self, spec: RunnerManagerJobSpec) -> DeploymentJobOut:
        paths = job_paths(spec.job_id)
        if not paths.job_dir.is_dir():
            raise HTTPException(status_code=404, detail="job not found")

        control = self._load_control(paths.runner_control_path)
        cli_args = control.get("cli_args") or []
        if not isinstance(cli_args, list) or not cli_args:
            raise HTTPException(
                status_code=400, detail="runner control file is invalid"
            )

        meta = load_json(paths.meta_path)
        if meta.get("status") == "running":
            return self.get(spec.job_id)

        cfg = replace(
            load_container_config(),
            image=spec.runner_image,
            network=spec.network_name,
        )
        try:
            cfg = replace(
                cfg,
                extra_args=_with_group_add(
                    cfg.extra_args,
                    paths.job_dir.stat().st_gid,
                ),
            )
        except Exception:
            pass

        runtime_env = {}
        secret_volume_name = ""
        tmpfs_mounts = [
            "/tmp:rw,noexec,nosuid,nodev,size=64m",
            "/run/infinito-repo:rw,exec,nosuid,nodev,size=256m,uid=10002,gid=10002,mode=0700",
            "/run/inventory:rw,noexec,nosuid,nodev,size=8m,uid=10002,gid=10002,mode=0700",
            "/run/sudo:rw,exec,nosuid,nodev,size=8m,uid=10002,gid=10002,mode=0700",
        ]
        if paths.secrets_dir.is_dir():
            secret_volume_name = self._secret_volume_name(spec.job_id)
            runtime_env["INFINITO_SECRETS_DIR"] = _RUNNER_SECRETS_DIR
            runtime_env["INFINITO_WAIT_FOR_SECRETS_READY"] = "1"
            runtime_env["INFINITO_SECRETS_READY_FILE"] = _RUNNER_SECRETS_READY_FILE

        bind_mounts: list[tuple[str, str, bool]] = []
        volume_mounts: list[tuple[str, str, bool]] = []
        if secret_volume_name:
            volume_mounts.append((secret_volume_name, _RUNNER_SECRETS_DIR, True))

        create_internal_network(spec.network_name)
        mode_a_targets: list[dict[str, Any]] = []
        try:
            if secret_volume_name:
                create_tmpfs_volume(secret_volume_name)
            mode_a_targets = self._connect_mode_a_targets(paths, spec.network_name)
            cmd, container_id, cfg = build_container_command(
                job_id=spec.job_id,
                job_dir=paths.job_dir,
                cli_args=[str(part) for part in cli_args],
                runtime_env=runtime_env,
                cfg=cfg,
                labels=spec.labels,
                container_user=os.getenv("RUNNER_CONTAINER_USER") or "10002:10002",
                read_only_root=True,
                tmpfs_mounts=tmpfs_mounts,
                bind_mounts=bind_mounts,
                volume_mounts=volume_mounts,
                hardened=True,
            )
        except Exception:
            self._disconnect_mode_a_targets(
                {
                    "network_name": spec.network_name,
                    "mode_a_targets": mode_a_targets,
                }
            )
            remove_network(spec.network_name)
            remove_volume(secret_volume_name)
            raise

        try:
            proc, log_fh, reader = start_process(
                run_path=paths.run_path,
                cwd=paths.job_dir,
                log_path=paths.log_path,
                secrets=[],
                args=cmd,
            )
        except Exception as exc:
            self._disconnect_mode_a_targets(
                {
                    "network_name": spec.network_name,
                    "mode_a_targets": mode_a_targets,
                }
            )
            remove_network(spec.network_name)
            remove_volume(secret_volume_name)
            meta["status"] = "failed"
            meta["finished_at"] = utc_iso()
            meta["exit_code"] = 127
            write_meta(paths.meta_path, meta)
            raise HTTPException(
                status_code=500, detail=f"failed to start runner: {exc}"
            ) from exc

        try:
            if secret_volume_name:
                self._wait_for_container_running(container_id)
                self._bootstrap_runner_secrets(
                    secret_volume_name=secret_volume_name,
                    source_dir=spec.secrets_dir,
                    image=cfg.image,
                )
        except Exception as exc:
            terminate_process_group(proc.pid if isinstance(proc.pid, int) else None)
            stop_container(container_id)
            remove_container(container_id)
            self._disconnect_mode_a_targets(
                {
                    "network_name": spec.network_name,
                    "mode_a_targets": mode_a_targets,
                }
            )
            remove_network(spec.network_name)
            meta["status"] = "failed"
            meta["finished_at"] = utc_iso()
            meta["exit_code"] = 127
            meta["container_id"] = container_id
            meta["network_name"] = spec.network_name
            meta["mode_a_targets"] = mode_a_targets
            meta["secret_volume_name"] = secret_volume_name
            write_meta(paths.meta_path, meta)
            self._cleanup_secret_dir(paths, secret_volume_name=secret_volume_name)
            try:
                proc.wait(timeout=5)
            except Exception:
                pass
            try:
                reader.join(timeout=1)
            except Exception:
                pass
            try:
                log_fh.close()
            except Exception:
                pass
            if isinstance(exc, HTTPException):
                raise exc
            raise HTTPException(
                status_code=500,
                detail=f"failed to seed runner secrets: {exc}",
            ) from exc

        meta["status"] = "running"
        meta["started_at"] = utc_iso()
        meta["pid"] = proc.pid
        meta["container_id"] = container_id
        meta["job_runner_image"] = cfg.image
        meta["network_name"] = spec.network_name
        meta["mode_a_targets"] = mode_a_targets
        meta["secret_volume_name"] = secret_volume_name
        write_meta(paths.meta_path, meta)

        threading.Thread(
            target=self._wait_and_finalize,
            args=(spec.job_id, proc, log_fh, reader),
            daemon=True,
        ).start()

        return self.get(spec.job_id)

    def get(
        self,
        job_id: str,
        *,
        workspace_id: str | None = None,
    ) -> DeploymentJobOut:
        rid = str(job_id or "").strip()
        if not rid:
            raise HTTPException(status_code=404, detail="job not found")

        paths = job_paths(rid)
        if not paths.job_dir.is_dir():
            raise HTTPException(status_code=404, detail="job not found")

        meta = load_json(paths.meta_path)
        self._ensure_workspace_match(paths, meta, workspace_id=workspace_id)
        return DeploymentJobOut(
            job_id=rid,
            status=meta.get("status") or "queued",
            created_at=meta.get("created_at") or utc_iso(),
            started_at=meta.get("started_at"),
            finished_at=meta.get("finished_at"),
            pid=meta.get("pid"),
            exit_code=meta.get("exit_code"),
            container_id=meta.get("container_id"),
            workspace_dir=str(paths.job_dir),
            log_path=str(paths.log_path),
            inventory_path=str(paths.inventory_path),
            request_path=str(paths.request_path),
        )

    def cancel(self, job_id: str, *, workspace_id: str | None = None) -> bool:
        rid = str(job_id or "").strip()
        if not rid:
            return False

        paths = job_paths(rid)
        meta = load_json(paths.meta_path)
        if not meta:
            return False
        self._ensure_workspace_match(paths, meta, workspace_id=workspace_id)
        if meta.get("status") in {"succeeded", "failed", "canceled"}:
            return True

        pid = meta.get("pid")
        terminate_process_group(pid if isinstance(pid, int) else None)

        container_id = str(meta.get("container_id") or "").strip()
        if container_id:
            stop_container(container_id)
        self._disconnect_mode_a_targets(meta)
        remove_network(str(meta.get("network_name") or "").strip())

        meta["status"] = "canceled"
        meta["finished_at"] = utc_iso()
        write_meta(paths.meta_path, meta)
        self._cleanup_secret_dir(
            paths,
            secret_volume_name=str(meta.get("secret_volume_name") or "").strip(),
        )
        return True

    def list_jobs(
        self,
        *,
        workspace_id: str | None = None,
        status: str | None = None,
    ) -> List[DeploymentJobOut]:
        out: List[DeploymentJobOut] = []
        for job_dir in sorted(jobs_root().iterdir() if jobs_root().exists() else []):
            if not job_dir.is_dir():
                continue
            meta = load_json(job_dir / "job.json")
            request = load_json(job_dir / "request.json")
            if workspace_id and str(request.get("workspace_id") or "") != workspace_id:
                continue
            if status and str(meta.get("status") or "") != status:
                continue
            try:
                out.append(self.get(job_dir.name, workspace_id=workspace_id))
            except HTTPException as exc:
                if workspace_id and exc.status_code in {403, 404}:
                    continue
                raise
        return out

    def stream_logs(
        self,
        job_id: str,
        *,
        workspace_id: str | None = None,
    ) -> Iterable[bytes]:
        paths = job_paths(job_id)
        self._ensure_workspace_match(
            paths,
            load_json(paths.meta_path),
            workspace_id=workspace_id,
        )
        if not paths.log_path.is_file():
            return []
        with paths.log_path.open("rb") as handle:
            while True:
                chunk = handle.read(8192)
                if not chunk:
                    break
                yield chunk

    def _ensure_workspace_match(
        self,
        paths,
        meta: Dict[str, Any],
        *,
        workspace_id: str | None,
    ) -> None:
        requested_workspace = str(workspace_id or "").strip()
        if not requested_workspace:
            return

        request_workspace = str(
            load_json(paths.request_path).get("workspace_id") or ""
        ).strip()
        if request_workspace and request_workspace != requested_workspace:
            raise HTTPException(status_code=404, detail="job not found")

        container_id = str(meta.get("container_id") or "").strip()
        status = str(meta.get("status") or "").strip().lower()
        if not container_id or status not in {"queued", "running"}:
            return

        live_workspace = str(
            inspect_container_labels(container_id).get("infinito.deployer.workspace_id")
            or ""
        ).strip()
        if live_workspace and live_workspace != requested_workspace:
            raise HTTPException(status_code=404, detail="job not found")

    def _load_control(self, path: Path) -> Dict[str, Any]:
        if not path.is_file():
            raise HTTPException(status_code=400, detail="runner control file missing")
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception as exc:
            raise HTTPException(
                status_code=400,
                detail=f"runner control file is invalid: {exc}",
            ) from exc

    def _collect_secret_values(self, paths) -> List[str]:
        secrets: List[str] = []
        for path in (
            paths.secret_ssh_key_path,
            paths.secret_ssh_password_path,
            paths.secret_vault_password_path,
            paths.secret_kdbx_path,
        ):
            if not path.is_file():
                continue
            try:
                raw = path.read_text(encoding="utf-8", errors="ignore")
            except Exception:
                continue
            raw = raw.strip()
            if not raw:
                continue
            secrets.append(raw)
            secrets.extend(line.strip() for line in raw.splitlines() if line.strip())
        deduped: List[str] = []
        seen: set[str] = set()
        for secret in secrets:
            if secret in seen:
                continue
            seen.add(secret)
            deduped.append(secret)
        return deduped

    def _cleanup_secret_dir(self, paths, *, secret_volume_name: str = "") -> None:
        try:
            if paths.ssh_key_path.exists():
                paths.ssh_key_path.unlink()
        except Exception:
            pass
        try:
            if paths.secrets_dir.exists():
                shutil.rmtree(paths.secrets_dir, ignore_errors=True)
        except Exception:
            pass
        remove_volume(secret_volume_name)

    def _wait_and_finalize(self, job_id: str, proc, log_fh, reader) -> None:
        paths = job_paths(job_id)
        try:
            rc = proc.wait()
            if reader is not None:
                reader.join(timeout=2)
        finally:
            try:
                log_fh.close()
            except Exception:
                pass

        meta = load_json(paths.meta_path)
        if meta.get("status") == "canceled":
            meta["finished_at"] = meta.get("finished_at") or utc_iso()
            write_meta(paths.meta_path, meta)
            self._disconnect_mode_a_targets(meta)
            remove_network(str(meta.get("network_name") or "").strip())
            self._cleanup_secret_dir(
                paths,
                secret_volume_name=str(meta.get("secret_volume_name") or "").strip(),
            )
            _release_process_memory()
            return

        meta["finished_at"] = utc_iso()
        meta["exit_code"] = int(rc)
        meta["status"] = "succeeded" if rc == 0 else "failed"
        write_meta(paths.meta_path, meta)
        self._disconnect_mode_a_targets(meta)
        remove_network(str(meta.get("network_name") or "").strip())
        self._cleanup_secret_dir(
            paths,
            secret_volume_name=str(meta.get("secret_volume_name") or "").strip(),
        )
        _release_process_memory()
