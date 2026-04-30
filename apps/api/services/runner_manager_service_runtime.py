from __future__ import annotations

import importlib

from fastapi import HTTPException

from .runner_manager_service_support import (
    RUNNER_SECRETS_DIR,
    RUNNER_SECRETS_READY_FILE,
)


def _root():
    return importlib.import_module("services.runner_manager_service")


class RunnerManagerServiceRuntimeMixin:
    def create(self, spec) -> object:
        root = _root()
        paths = root.job_paths(spec.job_id)
        if not paths.job_dir.is_dir():
            raise HTTPException(status_code=404, detail="job not found")

        control = self._load_control(paths.runner_control_path)
        cli_args = control.get("cli_args") or []
        if not isinstance(cli_args, list) or not cli_args:
            raise HTTPException(
                status_code=400,
                detail="runner control file is invalid",
            )

        meta = root.load_json(paths.meta_path)
        if meta.get("status") == "running":
            return self.get(spec.job_id)

        cfg = root.replace(
            root.load_container_config(),
            image=spec.runner_image,
            network=spec.network_name,
        )
        try:
            cfg = root.replace(
                cfg,
                extra_args=root._with_group_add(
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
            runtime_env["INFINITO_SECRETS_DIR"] = RUNNER_SECRETS_DIR
            runtime_env["INFINITO_WAIT_FOR_SECRETS_READY"] = "1"
            runtime_env["INFINITO_SECRETS_READY_FILE"] = RUNNER_SECRETS_READY_FILE

        create_args = {
            "job_id": spec.job_id,
            "job_dir": paths.job_dir,
            "cli_args": [str(part) for part in cli_args],
            "runtime_env": runtime_env,
            "cfg": cfg,
            "labels": spec.labels,
            "container_user": root.os.getenv("RUNNER_CONTAINER_USER") or "10002:10002",
            "read_only_root": True,
            "tmpfs_mounts": tmpfs_mounts,
            "bind_mounts": [],
            "volume_mounts": (
                [(secret_volume_name, RUNNER_SECRETS_DIR, True)]
                if secret_volume_name
                else []
            ),
            "hardened": True,
        }

        root.create_internal_network(spec.network_name)
        mode_a_targets: list[dict[str, object]] = []
        try:
            if secret_volume_name:
                root.create_tmpfs_volume(secret_volume_name)
            mode_a_targets = self._connect_mode_a_targets(paths, spec.network_name)
            cmd, container_id, cfg = root.build_container_command(**create_args)
        except Exception:
            self._disconnect_mode_a_targets(
                {
                    "network_name": spec.network_name,
                    "mode_a_targets": mode_a_targets,
                }
            )
            root.remove_network(spec.network_name)
            root.remove_volume(secret_volume_name)
            raise

        try:
            proc, log_fh, reader = root.start_process(
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
            root.remove_network(spec.network_name)
            root.remove_volume(secret_volume_name)
            meta["status"] = "failed"
            meta["finished_at"] = root.utc_iso()
            meta["exit_code"] = 127
            root.write_meta(paths.meta_path, meta)
            raise HTTPException(
                status_code=500,
                detail=f"failed to start runner: {exc}",
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
            root.terminate_process_group(
                proc.pid if isinstance(proc.pid, int) else None
            )
            # Capture the container's actual exit code BEFORE stopping
            # / removing it so failure diagnostics show why the runner
            # died (was: hardcoded 127 placeholder which masked the
            # real reason — e.g. slow CI startup that exceeded the
            # _wait_for_container_running deadline vs. an actual
            # command-not-found in the heredoc).
            actual_exit_code = 127
            try:
                inspect = root.subprocess.run(
                    [
                        root.resolve_docker_bin(),
                        "inspect",
                        "-f",
                        "{{.State.ExitCode}}",
                        container_id,
                    ],
                    stdout=root.subprocess.PIPE,
                    stderr=root.subprocess.DEVNULL,
                    text=True,
                    check=False,
                    timeout=3,
                )
                if inspect.returncode == 0:
                    parsed = (inspect.stdout or "").strip()
                    if parsed.lstrip("-").isdigit():
                        actual_exit_code = int(parsed)
            except Exception:  # pragma: no cover - diagnostic-only path
                pass
            root.stop_container(container_id)
            root.remove_container(container_id)
            self._disconnect_mode_a_targets(
                {
                    "network_name": spec.network_name,
                    "mode_a_targets": mode_a_targets,
                }
            )
            root.remove_network(spec.network_name)
            meta["status"] = "failed"
            meta["finished_at"] = root.utc_iso()
            meta["exit_code"] = actual_exit_code
            meta["container_id"] = container_id
            meta["network_name"] = spec.network_name
            meta["mode_a_targets"] = mode_a_targets
            meta["secret_volume_name"] = secret_volume_name
            root.write_meta(paths.meta_path, meta)
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
        meta["started_at"] = root.utc_iso()
        meta["pid"] = proc.pid
        meta["container_id"] = container_id
        meta["job_runner_image"] = cfg.image
        meta["network_name"] = spec.network_name
        meta["mode_a_targets"] = mode_a_targets
        meta["secret_volume_name"] = secret_volume_name
        root.write_meta(paths.meta_path, meta)

        root.threading.Thread(
            target=self._wait_and_finalize,
            args=(spec.job_id, proc, log_fh, reader),
            daemon=True,
        ).start()

        return self.get(spec.job_id)

    def get(self, job_id: str, *, workspace_id: str | None = None):
        root = _root()
        rid = str(job_id or "").strip()
        if not rid:
            raise HTTPException(status_code=404, detail="job not found")
        paths = root.job_paths(rid)
        if not paths.job_dir.is_dir():
            raise HTTPException(status_code=404, detail="job not found")
        meta = root.load_json(paths.meta_path)
        self._ensure_workspace_match(paths, meta, workspace_id=workspace_id)
        return root.DeploymentJobOut(
            job_id=rid,
            status=meta.get("status") or "queued",
            created_at=meta.get("created_at") or root.utc_iso(),
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
        root = _root()
        rid = str(job_id or "").strip()
        if not rid:
            return False
        paths = root.job_paths(rid)
        meta = root.load_json(paths.meta_path)
        if not meta:
            return False
        self._ensure_workspace_match(paths, meta, workspace_id=workspace_id)
        if meta.get("status") in {"succeeded", "failed", "canceled"}:
            return True

        pid = meta.get("pid")
        root.terminate_process_group(pid if isinstance(pid, int) else None)
        container_id = str(meta.get("container_id") or "").strip()
        if container_id:
            root.stop_container(container_id)
        self._disconnect_mode_a_targets(meta)
        root.remove_network(str(meta.get("network_name") or "").strip())

        meta["status"] = "canceled"
        meta["finished_at"] = root.utc_iso()
        root.write_meta(paths.meta_path, meta)
        self._cleanup_secret_dir(
            paths,
            secret_volume_name=str(meta.get("secret_volume_name") or "").strip(),
        )
        return True

    def list_jobs(self, *, workspace_id: str | None = None, status: str | None = None):
        root = _root()
        out = []
        for job_dir in sorted(
            root.jobs_root().iterdir() if root.jobs_root().exists() else []
        ):
            if not job_dir.is_dir():
                continue
            meta = root.load_json(job_dir / "job.json")
            request = root.load_json(job_dir / "request.json")
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

    def stream_logs(self, job_id: str, *, workspace_id: str | None = None):
        root = _root()
        paths = root.job_paths(job_id)
        self._ensure_workspace_match(
            paths,
            root.load_json(paths.meta_path),
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

    def _ensure_workspace_match(self, paths, meta, *, workspace_id: str | None) -> None:
        root = _root()
        requested_workspace = str(workspace_id or "").strip()
        if not requested_workspace:
            return
        request_workspace = str(
            root.load_json(paths.request_path).get("workspace_id") or ""
        ).strip()
        if request_workspace and request_workspace != requested_workspace:
            raise HTTPException(status_code=404, detail="job not found")

        container_id = str(meta.get("container_id") or "").strip()
        status = str(meta.get("status") or "").strip().lower()
        if not container_id or status not in {"queued", "running"}:
            return

        live_workspace = str(
            root.inspect_container_labels(container_id).get(
                "infinito.deployer.workspace_id"
            )
            or ""
        ).strip()
        if live_workspace and live_workspace != requested_workspace:
            raise HTTPException(status_code=404, detail="job not found")

    def _load_control(self, path) -> dict[str, object]:
        root = _root()
        if not path.is_file():
            raise HTTPException(status_code=400, detail="runner control file missing")
        try:
            return root.json.loads(path.read_text(encoding="utf-8"))
        except Exception as exc:
            raise HTTPException(
                status_code=400,
                detail=f"runner control file is invalid: {exc}",
            ) from exc

    def _collect_secret_values(self, paths) -> list[str]:
        secrets: list[str] = []
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
        deduped: list[str] = []
        seen: set[str] = set()
        for secret in secrets:
            if secret in seen:
                continue
            seen.add(secret)
            deduped.append(secret)
        return deduped

    def _cleanup_secret_dir(self, paths, *, secret_volume_name: str = "") -> None:
        root = _root()
        try:
            if paths.ssh_key_path.exists():
                paths.ssh_key_path.unlink()
        except Exception:
            pass
        try:
            if paths.secrets_dir.exists():
                root.shutil.rmtree(paths.secrets_dir, ignore_errors=True)
        except Exception:
            pass
        root.remove_volume(secret_volume_name)

    def _wait_and_finalize(self, job_id: str, proc, log_fh, reader) -> None:
        root = _root()
        paths = root.job_paths(job_id)
        try:
            rc = proc.wait()
            if reader is not None:
                reader.join(timeout=2)
        finally:
            try:
                log_fh.close()
            except Exception:
                pass

        meta = root.load_json(paths.meta_path)
        if meta.get("status") == "canceled":
            meta["finished_at"] = meta.get("finished_at") or root.utc_iso()
            root.write_meta(paths.meta_path, meta)
            self._disconnect_mode_a_targets(meta)
            root.remove_network(str(meta.get("network_name") or "").strip())
            self._cleanup_secret_dir(
                paths,
                secret_volume_name=str(meta.get("secret_volume_name") or "").strip(),
            )
            root._release_process_memory()
            return

        meta["finished_at"] = root.utc_iso()
        meta["exit_code"] = int(rc)
        meta["status"] = "succeeded" if rc == 0 else "failed"
        root.write_meta(paths.meta_path, meta)
        self._disconnect_mode_a_targets(meta)
        root.remove_network(str(meta.get("network_name") or "").strip())
        self._cleanup_secret_dir(
            paths,
            secret_volume_name=str(meta.get("secret_volume_name") or "").strip(),
        )
        root._release_process_memory()
