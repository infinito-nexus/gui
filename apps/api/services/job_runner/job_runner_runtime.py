from __future__ import annotations

import importlib


def _root():
    return importlib.import_module("services.job_runner.service")


class JobRunnerServiceRuntimeMixin:
    def create(self, req):
        root = _root()
        job_id = str(root.uuid.uuid4())
        network_name = f"job-{job_id}"
        paths = root.job_paths(job_id)
        root.safe_mkdir(paths.job_dir)
        use_runner_manager = self._runner_manager_enabled()
        managed_by_runner_manager = bool(
            use_runner_manager and not root.os.environ.get("RUNNER_CMD")
        )

        secrets = root.collect_secrets(req)
        runtime_vault_password = self._resolve_runtime_vault_password(req)
        if runtime_vault_password and runtime_vault_password not in secrets:
            secrets.append(runtime_vault_password)

        if req.workspace_id:
            self._copy_workspace_files(req.workspace_id, paths.job_dir)
        else:
            inv_yaml, _warnings = root.build_inventory_preview(req)
            root.atomic_write_text(paths.inventory_path, inv_yaml)

        self._inject_related_domains(req, paths.job_dir)
        self._materialize_workspace_group_vars_into_host_vars(paths.job_dir)
        if use_runner_manager:
            self._materialize_secret_files(
                paths=paths,
                req=req,
                runtime_vault_password=runtime_vault_password,
            )
        vars_data = self._build_vars(
            req,
            paths,
            secrets,
            use_secret_files=use_runner_manager,
        )
        roles_from_inventory: list[str] = []
        if req.workspace_id and paths.inventory_path.is_file():
            roles_from_inventory = self._roles_from_inventory(paths.inventory_path)
            if roles_from_inventory and not req.selected_roles:
                vars_data["selected_roles"] = roles_from_inventory

        root.atomic_write_json(
            paths.request_path, root.mask_request_for_persistence(req)
        )
        root.atomic_write_json(paths.vars_json_path, vars_data)
        root.atomic_write_text(
            paths.vars_yaml_path,
            root.yaml.safe_dump(
                vars_data,
                sort_keys=False,
                default_flow_style=False,
                allow_unicode=True,
            ),
        )
        root.write_runner_script(paths.run_path)
        root.write_infinito_shim(paths.job_dir)
        root.write_local_sudo_shim(paths.job_dir)
        root.write_controller_shims(paths.job_dir)
        root.write_runtime_command_shims(paths.job_dir)
        self._write_runner_identity_shims(paths)

        meta = {
            "job_id": job_id,
            "status": "queued",
            "created_at": root.utc_iso(),
            "started_at": None,
            "finished_at": None,
            "pid": None,
            "exit_code": None,
            "container_id": None,
            "network_name": network_name,
            "managed_by_runner_manager": managed_by_runner_manager,
        }
        root.write_meta(paths.meta_path, meta)
        self._remember_secrets(job_id, secrets)
        self._publish_job_line(job_id, "Queued deployment job.")
        runner_args = None
        selected_version = None
        resolved_runner_image = None
        cli_args: list[str] = []

        if not root.os.environ.get("RUNNER_CMD"):
            cfg = root.load_container_config()
            selected_version = self._resolve_infinito_nexus_version(req)
            cfg = root.replace(
                cfg,
                image=root.resolve_job_runner_image(
                    selected_version,
                    base_image=cfg.image,
                ),
            )
            resolved_runner_image = cfg.image
            inventory_arg = f"{cfg.workdir}/inventory.yml"
            cli_args = self._build_runner_args(
                req=req,
                job_dir=paths.job_dir,
                inventory_path=paths.inventory_path,
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
                runner_args, container_id, cfg = root.build_container_command(
                    job_id=job_id,
                    job_dir=paths.job_dir,
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
            root.write_meta(paths.meta_path, meta)

        self._publish_job_line(job_id, "Starting deployment runner.")
        if use_runner_manager and not root.os.environ.get("RUNNER_CMD"):
            self._write_runner_control(paths, cli_args=cli_args)
            job_spec = root.RunnerManagerJobSpec(
                job_id=job_id,
                workspace_id=req.workspace_id,
                runner_image=str(resolved_runner_image or ""),
                inventory_path="inventory.yml",
                secrets_dir=root.resolve_host_mount_source(str(paths.secrets_dir)),
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
                meta = root.load_json(paths.meta_path)
                meta["status"] = "failed"
                meta["finished_at"] = root.utc_iso()
                meta["exit_code"] = 127
                root.write_meta(paths.meta_path, meta)
                self._publish_job_line(
                    job_id,
                    f"[ERROR] failed to start runner-manager job: {exc}",
                )
                with self._secret_lock:
                    self._secret_store.pop(job_id, None)
                self._cleanup_secret_material(paths)
                raise
            root.threading.Thread(
                target=self._watch_managed_job_cleanup,
                args=(job_id,),
                daemon=True,
            ).start()
            return self.get(job_id)

        try:
            proc, log_fh, reader = root.start_process(
                run_path=paths.run_path,
                cwd=paths.job_dir,
                log_path=paths.log_path,
                secrets=secrets,
                on_line=lambda line: self._log_hub.publish(job_id, line),
                args=runner_args,
            )
        except Exception as exc:
            meta["status"] = "failed"
            meta["finished_at"] = root.utc_iso()
            meta["exit_code"] = 127
            root.write_meta(paths.meta_path, meta)
            self._publish_job_line(job_id, f"[ERROR] failed to start runner: {exc}")
            with self._secret_lock:
                self._secret_store.pop(job_id, None)
            self._cleanup_secret_material(paths)
            raise root.HTTPException(
                status_code=500,
                detail=f"failed to start runner: {exc}",
            ) from exc

        meta = root.load_json(paths.meta_path)
        meta["status"] = "running"
        meta["started_at"] = root.utc_iso()
        meta["pid"] = proc.pid
        root.write_meta(paths.meta_path, meta)

        root.threading.Thread(
            target=self._wait_and_finalize,
            args=(job_id, proc, log_fh, reader),
            daemon=True,
        ).start()

        return self.get(job_id)

    def get(self, job_id: str):
        root = _root()
        rid = (job_id or "").strip()
        if not rid:
            raise root.HTTPException(status_code=404, detail="job not found")
        paths = root.job_paths(rid)
        if not paths.job_dir.is_dir():
            raise root.HTTPException(status_code=404, detail="job not found")

        meta = root.load_json(paths.meta_path)
        status: root.JobStatus = meta.get("status") or "queued"
        if bool(meta.get("managed_by_runner_manager")) and status in {
            "succeeded",
            "failed",
            "canceled",
        }:
            self._cleanup_secret_material(paths)

        return root.DeploymentJobOut(
            job_id=rid,
            status=status,
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

    def cancel(self, job_id: str) -> bool:
        root = _root()
        rid = (job_id or "").strip()
        if not rid:
            return False
        paths = root.job_paths(rid)
        meta = root.load_json(paths.meta_path)
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
        root.terminate_process_group(pid if isinstance(pid, int) else None)
        container_id = meta.get("container_id")
        if isinstance(container_id, str) and container_id.strip():
            root.stop_container(container_id)

        meta["status"] = "canceled"
        meta["finished_at"] = root.utc_iso()
        root.write_meta(paths.meta_path, meta)
        self._cleanup_secret_material(paths)
        with self._secret_lock:
            self._secret_store.pop(rid, None)
        return True

    def _publish_job_line(self, job_id: str, line: str) -> None:
        root = _root()
        paths = root.job_paths(job_id)
        root.safe_mkdir(paths.job_dir)
        prefixed = f"[RX:{int(root.time.time() * 1000)}] {line}"
        with open(paths.log_path, "a", encoding="utf-8", buffering=1) as log_fh:
            log_fh.write(prefixed + "\n")
        self._log_hub.publish(job_id, prefixed)

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
            self._cleanup_secret_material(paths)
            with self._secret_lock:
                self._secret_store.pop(job_id, None)

        meta = root.load_json(paths.meta_path)
        status = meta.get("status")
        if status == "canceled":
            meta["finished_at"] = meta.get("finished_at") or root.utc_iso()
            root.write_meta(paths.meta_path, meta)
            root._release_process_memory()
            return

        meta["finished_at"] = root.utc_iso()
        meta["exit_code"] = int(rc)
        meta["status"] = "succeeded" if rc == 0 else "failed"
        root.write_meta(paths.meta_path, meta)
        root._release_process_memory()

    def _write_runner_control(self, paths, *, cli_args: list[str]) -> None:
        _root().atomic_write_json(
            paths.runner_control_path,
            {"cli_args": [str(arg) for arg in cli_args]},
        )

    def _materialize_secret_files(
        self, *, paths, req, runtime_vault_password: str | None
    ) -> None:
        root = _root()
        root.safe_mkdir(paths.secrets_dir)
        paths.secrets_dir.chmod(0o700)
        workspace_kdbx = (
            root.WorkspaceService().ensure(req.workspace_id)
            / "secrets"
            / root.KDBX_FILENAME
        )
        if workspace_kdbx.is_file():
            root.shutil.copyfile(workspace_kdbx, paths.secret_kdbx_path)
            paths.secret_kdbx_path.chmod(0o400)
        if req.auth.method == "private_key" and req.auth.private_key:
            root.atomic_write_text(paths.secret_ssh_key_path, req.auth.private_key)
            paths.secret_ssh_key_path.chmod(0o400)
        if req.auth.method == "password" and req.auth.password:
            root.atomic_write_text(paths.secret_ssh_password_path, req.auth.password)
            paths.secret_ssh_password_path.chmod(0o400)
        if runtime_vault_password:
            root.atomic_write_text(
                paths.secret_vault_password_path, runtime_vault_password
            )
            paths.secret_vault_password_path.chmod(0o400)

    def _build_vars(self, req, paths, secrets, *, use_secret_files: bool = False):
        root = _root()
        merged_vars = {"selected_roles": list(req.selected_roles)}
        if use_secret_files:
            return merged_vars

        if req.auth.method == "private_key" and req.auth.private_key:
            root.atomic_write_text(paths.ssh_key_path, req.auth.private_key)
            paths.ssh_key_path.chmod(0o600)
            merged_vars["ansible_ssh_private_key_file"] = str(paths.ssh_key_path)
            if req.auth.passphrase:
                merged_vars["ansible_ssh_pass"] = "<provided_at_runtime>"
        elif req.auth.method == "password":
            merged_vars["ansible_password"] = "<provided_at_runtime>"
            merged_vars["ansible_ssh_pass"] = "<provided_at_runtime>"
            merged_vars["ansible_become_password"] = "<provided_at_runtime>"
        return merged_vars
