from __future__ import annotations

import copy
from dataclasses import replace
import os
import shlex
import shutil
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List

import yaml

from fastapi import HTTPException

from api.schemas.deployment import DeploymentRequest
from api.schemas.deployment_job import DeploymentJobOut, JobStatus
from api.schemas.runner_manager import RunnerManagerJobSpec
from services.inventory_preview import build_inventory_preview
from services.infinito_nexus_versions import (
    normalize_infinito_nexus_version,
    resolve_job_runner_image,
)
from services.runner_manager_client import RunnerManagerClient
from services.workspaces import WorkspaceService
from services.workspaces.workspace_context import (
    _WorkspaceYamlDumper,
    load_workspace_yaml_document,
)
from services.workspaces.vault import KDBX_FILENAME, _vault_password_from_kdbx

from .paths import job_paths, jobs_root
from .persistence import load_json, mask_request_for_persistence, write_meta
from .runner import start_process, terminate_process_group, write_runner_script
from .config import env_bool
from .container_runner import (
    build_container_command,
    load_container_config,
    resolve_host_mount_source,
    stop_container,
)
from .related_roles import discover_related_role_domains
from .secrets import collect_secrets
from .shims import (
    write_controller_shims,
    write_infinito_shim,
    write_local_sudo_shim,
    write_runtime_command_shims,
)
from .util import atomic_write_json, atomic_write_text, safe_mkdir, utc_iso
from .log_hub import LogHub, _release_process_memory

_WORKSPACE_SKIP_FILES = {"workspace.json", "credentials.kdbx"}
_RUNNER_PASSWD = """root:x:0:0:root:/root:/bin/sh
runner:x:10002:10002:Infinito Runner:/tmp/infinito-home:/usr/bin/nologin
"""
_RUNNER_GROUP = """root:x:0:
runner:x:10002:
"""
_RUNNER_SUDOERS = "runner ALL=(ALL) NOPASSWD:ALL\n"
_WORKSPACE_HOST_VAR_OVERRIDE_KEYS = ("users", "applications")


class JobRunnerService:
    """
    Filesystem-based job runner.

    Layout:
      ${STATE_DIR}/jobs/<job_id>/
        job.json        (status, pid, timestamps)
        request.json    (masked request - no secrets)
        inventory.yml   (copied from workspace)
        job.log         (stdout/stderr of runner)
        run.sh          (runner script)
    """

    def __init__(self) -> None:
        safe_mkdir(jobs_root())
        self._purge_orphaned_secret_material()
        self._secret_lock = threading.Lock()
        self._secret_store: Dict[str, List[str]] = {}
        self._log_hub = LogHub()

    def _runner_manager_enabled(self) -> bool:
        return RunnerManagerClient().enabled()

    def _runner_manager_client(self) -> RunnerManagerClient:
        return RunnerManagerClient()

    def _cleanup_secret_material(self, paths) -> None:
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

    def _watch_managed_job_cleanup(self, job_id: str) -> None:
        paths = job_paths(job_id)
        terminal_statuses = {"succeeded", "failed", "canceled"}
        while paths.job_dir.is_dir():
            meta = load_json(paths.meta_path)
            status = str(meta.get("status") or "").strip().lower()
            if status in terminal_statuses:
                self._cleanup_secret_material(paths)
                _release_process_memory()
                return
            time.sleep(0.5)

    def _purge_orphaned_secret_material(self) -> None:
        for job_dir in sorted(jobs_root().iterdir() if jobs_root().exists() else []):
            if not job_dir.is_dir():
                continue
            paths = job_paths(job_dir.name)
            meta = load_json(paths.meta_path)
            status = str(meta.get("status") or "").strip().lower()
            pid = meta.get("pid")
            pid_running = isinstance(pid, int) and self._pid_is_running(pid)
            if status == "running" and pid_running:
                continue
            self._cleanup_secret_material(paths)

    def _pid_is_running(self, pid: int) -> bool:
        try:
            os.kill(int(pid), 0)
        except Exception:
            return False
        return True

    def _copy_workspace_files(self, workspace_id: str, dest_root: Path) -> None:
        svc = WorkspaceService()
        src_root = svc.ensure(workspace_id)
        inventory_path = src_root / "inventory.yml"
        if not inventory_path.is_file():
            raise HTTPException(
                status_code=400, detail="workspace inventory.yml not found"
            )

        for dirpath, dirnames, filenames in os.walk(src_root):
            rel = Path(dirpath).relative_to(src_root)
            target_dir = dest_root / rel
            safe_mkdir(target_dir)

            # Skip hidden/system folders if they show up in the workspace root
            dirnames[:] = [
                d for d in dirnames if not d.startswith(".") and d != "secrets"
            ]

            for fname in filenames:
                if fname.startswith(".") or fname in _WORKSPACE_SKIP_FILES:
                    continue
                src = Path(dirpath) / fname
                dst = target_dir / fname
                shutil.copy2(src, dst)

    def _roles_from_inventory(self, inventory_path: Path) -> List[str]:
        try:
            raw = inventory_path.read_text(encoding="utf-8", errors="replace")
            data = yaml.safe_load(raw) or {}
            children = (data or {}).get("all", {}).get("children", {})
            if isinstance(children, dict):
                return [str(k).strip() for k in children.keys() if str(k).strip()]
        except Exception:
            return []
        return []

    def _resolve_domain_primary(self, workspace_root: Path) -> str:
        candidates = [
            workspace_root / "group_vars" / "all.yml",
            *sorted((workspace_root / "host_vars").glob("*.yml")),
        ]

        for path in candidates:
            try:
                loaded = yaml.safe_load(
                    path.read_text(encoding="utf-8", errors="replace")
                )
            except Exception:
                continue
            if not isinstance(loaded, dict):
                continue
            value = str(loaded.get("DOMAIN_PRIMARY") or "").strip()
            if value:
                return value

        env_domain = str(
            os.getenv("DOMAIN_PRIMARY") or os.getenv("DOMAIN") or ""
        ).strip()
        return env_domain or "infinito.localhost"

    def _inventory_host_aliases(self, inventory_path: Path) -> List[str]:
        try:
            loaded = yaml.safe_load(
                inventory_path.read_text(encoding="utf-8", errors="replace")
            )
        except Exception:
            return []
        data = loaded if isinstance(loaded, dict) else {}
        aliases: List[str] = []
        seen: set[str] = set()

        def _append_mapping_hosts(hosts: Any) -> None:
            if not isinstance(hosts, dict):
                return
            for alias in hosts.keys():
                normalized = str(alias).strip()
                if not normalized or normalized in seen:
                    continue
                seen.add(normalized)
                aliases.append(normalized)

        all_node = data.get("all") or {}
        if isinstance(all_node, dict):
            _append_mapping_hosts(all_node.get("hosts"))
            children = all_node.get("children") or {}
            if isinstance(children, dict):
                for child in children.values():
                    if not isinstance(child, dict):
                        continue
                    _append_mapping_hosts(child.get("hosts"))

        return aliases

    def _job_host_aliases(self, job_dir: Path) -> List[str]:
        host_vars_dir = job_dir / "host_vars"
        existing_host_vars = [
            path.stem for path in sorted(host_vars_dir.glob("*.yml")) if path.is_file()
        ]
        if existing_host_vars:
            return existing_host_vars
        return self._inventory_host_aliases(job_dir / "inventory.yml")

    def _inject_related_domains(self, req: DeploymentRequest, job_dir: Path) -> None:
        selected_roles = [
            str(role_id).strip() for role_id in req.selected_roles if role_id
        ]
        if not selected_roles:
            return

        related_domains = discover_related_role_domains(
            selected_roles=selected_roles,
            domain_primary=self._resolve_domain_primary(job_dir),
        )
        if not related_domains:
            return

        host_vars_dir = job_dir / "host_vars"
        safe_mkdir(host_vars_dir)
        host_aliases = self._job_host_aliases(job_dir)
        if not host_aliases:
            host_aliases = ["target"]

        for alias in host_aliases:
            host_vars_path = host_vars_dir / f"{alias}.yml"
            loaded: Dict[str, Any] = {}
            if host_vars_path.is_file():
                try:
                    loaded_raw = load_workspace_yaml_document(
                        host_vars_path.read_text(encoding="utf-8", errors="replace")
                    )
                except Exception:
                    loaded_raw = {}
                loaded = loaded_raw if isinstance(loaded_raw, dict) else {}

            domains = loaded.get("domains")
            if not isinstance(domains, dict):
                domains = {}

            changed = False
            for role_id, values in related_domains.items():
                if role_id in domains:
                    continue
                domains[role_id] = list(values)
                changed = True

            if not changed and host_vars_path.is_file():
                continue

            loaded["domains"] = domains
            atomic_write_text(
                host_vars_path,
                yaml.dump(
                    loaded,
                    Dumper=_WorkspaceYamlDumper,
                    sort_keys=False,
                    default_flow_style=False,
                    allow_unicode=True,
                ),
            )

    def _write_runner_identity_shims(self, paths) -> None:
        atomic_write_text(paths.passwd_path, _RUNNER_PASSWD)
        atomic_write_text(paths.group_path, _RUNNER_GROUP)
        atomic_write_text(paths.sudoers_path, _RUNNER_SUDOERS)
        paths.passwd_path.chmod(0o644)
        paths.group_path.chmod(0o644)
        paths.sudoers_path.chmod(0o440)

    def _merge_nested_mappings(
        self, base: Dict[str, Any], override: Dict[str, Any]
    ) -> Dict[str, Any]:
        merged = copy.deepcopy(base)
        for key, value in override.items():
            existing = merged.get(key)
            if isinstance(existing, dict) and isinstance(value, dict):
                merged[key] = self._merge_nested_mappings(existing, value)
            else:
                merged[key] = copy.deepcopy(value)
        return merged

    def _materialize_workspace_group_vars_into_host_vars(self, job_dir: Path) -> None:
        workspace_group_vars = job_dir / "group_vars" / "all.yml"
        if not workspace_group_vars.is_file():
            return

        loaded_raw = load_workspace_yaml_document(
            workspace_group_vars.read_text(encoding="utf-8", errors="replace")
        )
        if loaded_raw is None:
            return
        if not isinstance(loaded_raw, dict):
            raise HTTPException(
                status_code=400,
                detail="workspace group_vars/all.yml must contain a YAML mapping",
            )

        workspace_overrides = {
            key: value
            for key in _WORKSPACE_HOST_VAR_OVERRIDE_KEYS
            for value in [loaded_raw.get(key)]
            if isinstance(value, dict) and value
        }
        if not workspace_overrides:
            return

        host_vars_dir = job_dir / "host_vars"
        safe_mkdir(host_vars_dir)
        host_aliases = self._job_host_aliases(job_dir)
        if not host_aliases:
            return

        for alias in host_aliases:
            host_vars_path = host_vars_dir / f"{alias}.yml"
            existing_host_vars: Dict[str, Any] = {}
            if host_vars_path.is_file():
                try:
                    existing_raw = load_workspace_yaml_document(
                        host_vars_path.read_text(encoding="utf-8", errors="replace")
                    )
                except Exception:
                    existing_raw = {}
                existing_host_vars = (
                    existing_raw if isinstance(existing_raw, dict) else {}
                )

            for key, workspace_value in workspace_overrides.items():
                existing_value = existing_host_vars.get(key)
                if isinstance(existing_value, dict) and existing_value:
                    existing_host_vars[key] = self._merge_nested_mappings(
                        workspace_value, existing_value
                    )
                else:
                    existing_host_vars[key] = copy.deepcopy(workspace_value)
            atomic_write_text(
                host_vars_path,
                yaml.dump(
                    existing_host_vars,
                    Dumper=_WorkspaceYamlDumper,
                    sort_keys=False,
                    default_flow_style=False,
                    allow_unicode=True,
                ),
            )

    def create(self, req: DeploymentRequest) -> DeploymentJobOut:
        job_id = str(uuid.uuid4())
        network_name = f"job-{job_id}"
        p = job_paths(job_id)
        safe_mkdir(p.job_dir)
        use_runner_manager = self._runner_manager_enabled()
        managed_by_runner_manager = bool(
            use_runner_manager and not os.environ.get("RUNNER_CMD")
        )

        secrets = collect_secrets(req)
        runtime_vault_password = self._resolve_runtime_vault_password(req)
        if runtime_vault_password and runtime_vault_password not in secrets:
            secrets.append(runtime_vault_password)

        if req.workspace_id:
            self._copy_workspace_files(req.workspace_id, p.job_dir)
        else:
            inv_yaml, _warnings = build_inventory_preview(req)
            atomic_write_text(p.inventory_path, inv_yaml)

        self._inject_related_domains(req, p.job_dir)
        self._materialize_workspace_group_vars_into_host_vars(p.job_dir)
        if use_runner_manager:
            self._materialize_secret_files(
                paths=p,
                req=req,
                runtime_vault_password=runtime_vault_password,
            )
        vars_data = self._build_vars(
            req, p, secrets, use_secret_files=use_runner_manager
        )
        roles_from_inventory: List[str] = []
        if req.workspace_id and p.inventory_path.is_file():
            roles_from_inventory = self._roles_from_inventory(p.inventory_path)
            if roles_from_inventory and not req.selected_roles:
                vars_data["selected_roles"] = roles_from_inventory

        atomic_write_json(p.request_path, mask_request_for_persistence(req))
        atomic_write_json(p.vars_json_path, vars_data)
        atomic_write_text(
            p.vars_yaml_path,
            yaml.safe_dump(
                vars_data,
                sort_keys=False,
                default_flow_style=False,
                allow_unicode=True,
            ),
        )
        write_runner_script(p.run_path)
        write_infinito_shim(p.job_dir)
        write_local_sudo_shim(p.job_dir)
        write_controller_shims(p.job_dir)
        write_runtime_command_shims(p.job_dir)
        self._write_runner_identity_shims(p)

        meta: Dict[str, Any] = {
            "job_id": job_id,
            "status": "queued",
            "created_at": utc_iso(),
            "started_at": None,
            "finished_at": None,
            "pid": None,
            "exit_code": None,
            "container_id": None,
            "network_name": network_name,
            "managed_by_runner_manager": managed_by_runner_manager,
        }
        write_meta(p.meta_path, meta)
        self._remember_secrets(job_id, secrets)
        self._publish_job_line(job_id, "Queued deployment job.")
        runner_args = None
        selected_version = None
        resolved_runner_image = None
        cli_args: List[str] = []
        if not os.environ.get("RUNNER_CMD"):
            cfg = load_container_config()
            selected_version = self._resolve_infinito_nexus_version(req)
            cfg = replace(
                cfg,
                image=resolve_job_runner_image(
                    selected_version,
                    base_image=cfg.image,
                ),
            )
            resolved_runner_image = cfg.image
            inventory_arg = f"{cfg.workdir}/inventory.yml"

            cli_args = self._build_runner_args(
                req=req,
                job_dir=p.job_dir,
                inventory_path=p.inventory_path,
                inventory_arg=inventory_arg,
                roles_from_inventory=roles_from_inventory,
            )

            meta["infinito_nexus_version"] = selected_version
            meta["job_runner_image"] = cfg.image
            if cfg.skip_cleanup:
                meta["skip_cleanup"] = True
            if cfg.skip_build:
                meta["skip_build"] = True
            if not use_runner_manager:
                runner_args, container_id, cfg = build_container_command(
                    job_id=job_id,
                    job_dir=p.job_dir,
                    cli_args=cli_args,
                    runtime_env={
                        "INFINITO_RUNTIME_PASSWORD": req.auth.password or "",
                        "INFINITO_RUNTIME_SSH_PASS": (
                            req.auth.password
                            if req.auth.method == "password"
                            else (req.auth.passphrase or "")
                        ),
                        "INFINITO_RUNTIME_VAULT_PASSWORD": runtime_vault_password or "",
                    },
                    cfg=cfg,
                )
                meta["container_id"] = container_id
            write_meta(p.meta_path, meta)

        self._publish_job_line(job_id, "Starting deployment runner.")
        if use_runner_manager and not os.environ.get("RUNNER_CMD"):
            self._write_runner_control(p, cli_args=cli_args)
            job_spec = RunnerManagerJobSpec(
                job_id=job_id,
                workspace_id=req.workspace_id,
                runner_image=str(resolved_runner_image or ""),
                inventory_path="inventory.yml",
                secrets_dir=resolve_host_mount_source(str(p.secrets_dir)),
                role_ids=list(req.selected_roles or roles_from_inventory),
                network_name=network_name,
                labels={
                    "infinito.deployer.job_id": job_id,
                    "infinito.deployer.workspace_id": req.workspace_id,
                    "infinito.deployer.role": "job-runner",
                },
            )
            try:
                self._runner_manager_client().start_job(job_spec)
            except Exception as exc:
                meta = load_json(p.meta_path)
                meta["status"] = "failed"
                meta["finished_at"] = utc_iso()
                meta["exit_code"] = 127
                write_meta(p.meta_path, meta)
                self._publish_job_line(
                    job_id, f"[ERROR] failed to start runner-manager job: {exc}"
                )
                with self._secret_lock:
                    self._secret_store.pop(job_id, None)
                self._cleanup_secret_material(p)
                raise
            threading.Thread(
                target=self._watch_managed_job_cleanup,
                args=(job_id,),
                daemon=True,
            ).start()
            return self.get(job_id)

        try:
            proc, log_fh, reader = start_process(
                run_path=p.run_path,
                cwd=p.job_dir,
                log_path=p.log_path,
                secrets=secrets,
                on_line=lambda line: self._log_hub.publish(job_id, line),
                args=runner_args,
            )
        except Exception as exc:
            meta["status"] = "failed"
            meta["finished_at"] = utc_iso()
            meta["exit_code"] = 127
            write_meta(p.meta_path, meta)
            self._publish_job_line(job_id, f"[ERROR] failed to start runner: {exc}")
            with self._secret_lock:
                self._secret_store.pop(job_id, None)
            self._cleanup_secret_material(p)
            raise HTTPException(
                status_code=500, detail=f"failed to start runner: {exc}"
            ) from exc

        meta = load_json(p.meta_path)
        meta["status"] = "running"
        meta["started_at"] = utc_iso()
        meta["pid"] = proc.pid
        write_meta(p.meta_path, meta)

        threading.Thread(
            target=self._wait_and_finalize,
            args=(job_id, proc, log_fh, reader),
            daemon=True,
        ).start()

        return self.get(job_id)

    def get(self, job_id: str) -> DeploymentJobOut:
        rid = (job_id or "").strip()
        if not rid:
            raise HTTPException(status_code=404, detail="job not found")

        p = job_paths(rid)
        if not p.job_dir.is_dir():
            raise HTTPException(status_code=404, detail="job not found")

        meta = load_json(p.meta_path)
        status: JobStatus = meta.get("status") or "queued"
        if bool(meta.get("managed_by_runner_manager")) and status in {
            "succeeded",
            "failed",
            "canceled",
        }:
            self._cleanup_secret_material(p)

        return DeploymentJobOut(
            job_id=rid,
            status=status,
            created_at=meta.get("created_at") or utc_iso(),
            started_at=meta.get("started_at"),
            finished_at=meta.get("finished_at"),
            pid=meta.get("pid"),
            exit_code=meta.get("exit_code"),
            container_id=meta.get("container_id"),
            workspace_dir=str(p.job_dir),
            log_path=str(p.log_path),
            inventory_path=str(p.inventory_path),
            request_path=str(p.request_path),
        )

    def cancel(self, job_id: str) -> bool:
        rid = (job_id or "").strip()
        if not rid:
            return False

        p = job_paths(rid)
        meta: Dict[str, Any] = load_json(p.meta_path)
        if not meta:
            return False

        if meta.get("status") in {"succeeded", "failed", "canceled"}:
            return True

        if bool(meta.get("managed_by_runner_manager")):
            ok = self._runner_manager_client().cancel_job(rid).ok
            with self._secret_lock:
                self._secret_store.pop(rid, None)
            return ok

        pid = meta.get("pid")
        terminate_process_group(pid if isinstance(pid, int) else None)

        container_id = meta.get("container_id")
        if isinstance(container_id, str) and container_id.strip():
            stop_container(container_id)

        meta["status"] = "canceled"
        meta["finished_at"] = utc_iso()
        write_meta(p.meta_path, meta)
        self._cleanup_secret_material(p)
        with self._secret_lock:
            self._secret_store.pop(rid, None)
        return True

    def _publish_job_line(self, job_id: str, line: str) -> None:
        p = job_paths(job_id)
        safe_mkdir(p.job_dir)
        prefixed = f"[RX:{int(time.time() * 1000)}] {line}"
        with open(p.log_path, "a", encoding="utf-8", buffering=1) as log_fh:
            log_fh.write(prefixed + "\n")
        self._log_hub.publish(job_id, prefixed)

    def _wait_and_finalize(self, job_id: str, proc, log_fh, reader) -> None:
        p = job_paths(job_id)
        try:
            rc = proc.wait()
            if reader is not None:
                reader.join(timeout=2)
        finally:
            try:
                log_fh.close()
            except Exception:
                pass
            self._cleanup_secret_material(p)
            with self._secret_lock:
                self._secret_store.pop(job_id, None)

        meta: Dict[str, Any] = load_json(p.meta_path)
        status = meta.get("status")

        # If canceled while running, keep canceled
        if status == "canceled":
            meta["finished_at"] = meta.get("finished_at") or utc_iso()
            write_meta(p.meta_path, meta)
            _release_process_memory()
            return

        meta["finished_at"] = utc_iso()
        meta["exit_code"] = int(rc)
        meta["status"] = "succeeded" if rc == 0 else "failed"
        write_meta(p.meta_path, meta)
        _release_process_memory()

    def _write_runner_control(
        self,
        paths,
        *,
        cli_args: List[str],
    ) -> None:
        atomic_write_json(
            paths.runner_control_path,
            {
                "cli_args": [str(arg) for arg in cli_args],
            },
        )

    def _materialize_secret_files(
        self,
        *,
        paths,
        req: DeploymentRequest,
        runtime_vault_password: str | None,
    ) -> None:
        safe_mkdir(paths.secrets_dir)
        paths.secrets_dir.chmod(0o700)
        workspace_kdbx = (
            WorkspaceService().ensure(req.workspace_id) / "secrets" / KDBX_FILENAME
        )
        if workspace_kdbx.is_file():
            shutil.copyfile(workspace_kdbx, paths.secret_kdbx_path)
            paths.secret_kdbx_path.chmod(0o400)
        if req.auth.method == "private_key" and req.auth.private_key:
            atomic_write_text(paths.secret_ssh_key_path, req.auth.private_key)
            paths.secret_ssh_key_path.chmod(0o400)
        if req.auth.method == "password" and req.auth.password:
            atomic_write_text(paths.secret_ssh_password_path, req.auth.password)
            paths.secret_ssh_password_path.chmod(0o400)
        if runtime_vault_password:
            atomic_write_text(paths.secret_vault_password_path, runtime_vault_password)
            paths.secret_vault_password_path.chmod(0o400)

    def _build_vars(
        self,
        req: DeploymentRequest,
        paths,
        secrets: List[str],
        *,
        use_secret_files: bool = False,
    ) -> Dict[str, Any]:
        merged_vars: Dict[str, Any] = {
            "selected_roles": list(req.selected_roles),
        }

        # Runner-manager jobs inject credentials via secret files and
        # group_vars/all/_secrets.yml. Persisted extra-vars must therefore not
        # carry auth placeholders, because `-e @vars.json` would override the
        # secret-backed inventory variables at highest Ansible precedence.
        if use_secret_files:
            return merged_vars

        if req.auth.method == "private_key" and req.auth.private_key:
            atomic_write_text(paths.ssh_key_path, req.auth.private_key)
            paths.ssh_key_path.chmod(0o600)
            merged_vars["ansible_ssh_private_key_file"] = str(paths.ssh_key_path)
            if req.auth.passphrase:
                merged_vars["ansible_ssh_pass"] = "<provided_at_runtime>"
        elif req.auth.method == "password":
            merged_vars["ansible_password"] = "<provided_at_runtime>"
            merged_vars["ansible_ssh_pass"] = "<provided_at_runtime>"
            merged_vars["ansible_become_password"] = "<provided_at_runtime>"

        return merged_vars

    def _workspace_requires_vault(self, workspace_root: Path) -> bool:
        for dirpath, dirnames, filenames in os.walk(workspace_root):
            dirnames[:] = [
                d for d in dirnames if not d.startswith(".") and d != "secrets"
            ]
            for fname in filenames:
                path = Path(dirpath) / fname
                try:
                    text = path.read_text(encoding="utf-8", errors="ignore")
                except Exception:
                    continue
                if "!vault |" in text or "$ANSIBLE_VAULT;" in text:
                    return True
        return False

    def _resolve_runtime_vault_password(self, req: DeploymentRequest) -> str | None:
        workspace_id = (req.workspace_id or "").strip()
        if not workspace_id:
            return None

        workspace_root = WorkspaceService().ensure(workspace_id)
        if not self._workspace_requires_vault(workspace_root):
            return None

        if not req.master_password:
            raise HTTPException(
                status_code=400,
                detail=(
                    "master_password is required for workspaces with "
                    "vault-encrypted values"
                ),
            )

        return _vault_password_from_kdbx(workspace_root, req.master_password)

    def _resolve_infinito_nexus_version(self, req: DeploymentRequest) -> str:
        requested = str(req.infinito_nexus_version or "").strip()
        if requested:
            return normalize_infinito_nexus_version(requested)

        workspace_root = WorkspaceService().ensure(req.workspace_id)
        try:
            meta = load_json(workspace_root / "workspace.json")
        except Exception:
            meta = {}
        return normalize_infinito_nexus_version(
            str(meta.get("infinito_nexus_version") or "").strip() or "latest"
        )

    def _build_runner_args(
        self,
        *,
        req: DeploymentRequest,
        job_dir: Path,
        inventory_path: Path,
        inventory_arg: str,
        roles_from_inventory: List[str],
    ) -> List[str]:
        if not inventory_path.is_file():
            raise HTTPException(status_code=500, detail="inventory.yml is missing")

        if req.playbook_path:
            cmd = self._build_direct_playbook_args(
                req=req,
                job_dir=job_dir,
                inventory_arg=inventory_arg,
                inventory_path=inventory_path,
            )
        else:
            cmd = [
                "infinito",
                "deploy",
                "dedicated",
                inventory_arg,
            ]

            if req.limit:
                cmd.extend(["-l", req.limit])

            if env_bool("JOB_RUNNER_SKIP_CLEANUP", False):
                cmd.append("--skip-cleanup")
            if env_bool("JOB_RUNNER_SKIP_BUILD", False):
                cmd.append("--skip-build")

            roles = list(req.selected_roles or [])
            if not roles:
                roles = roles_from_inventory
            if roles:
                cmd.append("--id")
                cmd.extend(roles)

        vars_path = inventory_path.with_name("vars.json")
        if vars_path.is_file():
            vars_arg = str(Path(inventory_arg).with_name("vars.json"))
            cmd.extend(["-e", f"@{vars_arg}"])

        extra_args_raw = (os.getenv("JOB_RUNNER_ANSIBLE_ARGS") or "").strip()
        if extra_args_raw:
            try:
                cmd.extend(shlex.split(extra_args_raw))
            except ValueError as exc:
                raise HTTPException(
                    status_code=500,
                    detail=f"invalid JOB_RUNNER_ANSIBLE_ARGS: {exc}",
                ) from exc

        return cmd

    def _build_direct_playbook_args(
        self,
        *,
        req: DeploymentRequest,
        job_dir: Path,
        inventory_arg: str,
        inventory_path: Path,
    ) -> List[str]:
        rel_path = str(req.playbook_path or "").strip().lstrip("/")
        if not rel_path:
            raise HTTPException(status_code=400, detail="playbook_path is required")

        job_root = job_dir.resolve()
        playbook_host_path = (job_dir / rel_path).resolve()
        if playbook_host_path == job_root or job_root not in playbook_host_path.parents:
            raise HTTPException(status_code=400, detail="invalid playbook_path")
        if not playbook_host_path.is_file():
            raise HTTPException(status_code=400, detail="playbook_path not found")

        playbook_arg = (Path(inventory_arg).parent / rel_path).as_posix()
        cmd: List[str] = [
            "ansible-playbook",
            "-i",
            inventory_arg,
            playbook_arg,
        ]
        if req.limit:
            cmd.extend(["-l", req.limit])
        return cmd

    def _remember_secrets(self, job_id: str, secrets: List[str]) -> None:
        if not secrets:
            return
        with self._secret_lock:
            self._secret_store[job_id] = secrets

    def get_secrets(self, job_id: str) -> List[str]:
        with self._secret_lock:
            return list(self._secret_store.get(job_id, []))

    def subscribe_logs(self, job_id: str, *, replay_buffer: bool = True):
        return self._log_hub.subscribe(job_id, replay_buffer=replay_buffer)

    def unsubscribe_logs(self, job_id: str, q) -> None:
        self._log_hub.unsubscribe(job_id, q)
