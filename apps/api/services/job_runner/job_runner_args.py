from __future__ import annotations

import importlib


def _root():
    return importlib.import_module("services.job_runner.service")


class JobRunnerServiceArgsMixin:
    def _workspace_requires_vault(self, workspace_root) -> bool:
        root = _root()
        for dirpath, dirnames, filenames in root.os.walk(workspace_root):
            dirnames[:] = [
                dirname
                for dirname in dirnames
                if not dirname.startswith(".") and dirname != "secrets"
            ]
            for filename in filenames:
                path = root.Path(dirpath) / filename
                try:
                    text = path.read_text(encoding="utf-8", errors="ignore")
                except Exception:
                    continue
                if "!vault |" in text or "$ANSIBLE_VAULT;" in text:
                    return True
        return False

    def _resolve_runtime_vault_password(self, req) -> str | None:
        root = _root()
        workspace_id = (req.workspace_id or "").strip()
        if not workspace_id:
            return None
        workspace_root = root.WorkspaceService().ensure(workspace_id)
        if not self._workspace_requires_vault(workspace_root):
            return None
        if not req.master_password:
            raise root.HTTPException(
                status_code=400,
                detail=(
                    "master_password is required for workspaces with "
                    "vault-encrypted values"
                ),
            )
        return root._vault_password_from_kdbx(workspace_root, req.master_password)

    def _resolve_infinito_nexus_version(self, req) -> str:
        root = _root()
        requested = str(req.infinito_nexus_version or "").strip()
        if requested:
            return root.normalize_infinito_nexus_version(requested)
        workspace_root = root.WorkspaceService().ensure(req.workspace_id)
        try:
            meta = root.load_json(workspace_root / "workspace.json")
        except Exception:
            meta = {}
        return root.normalize_infinito_nexus_version(
            str(meta.get("infinito_nexus_version") or "").strip() or "latest"
        )

    def _build_runner_args(
        self,
        *,
        req,
        job_dir,
        inventory_path,
        inventory_arg: str,
        roles_from_inventory: list[str],
    ) -> list[str]:
        root = _root()
        if not inventory_path.is_file():
            raise root.HTTPException(status_code=500, detail="inventory.yml is missing")

        if req.playbook_path:
            cmd = self._build_direct_playbook_args(
                req=req,
                job_dir=job_dir,
                inventory_arg=inventory_arg,
                inventory_path=inventory_path,
            )
        else:
            cmd = ["infinito", "deploy", "dedicated", inventory_arg]
            if req.limit:
                cmd.extend(["-l", req.limit])
            if root.env_bool("JOB_RUNNER_SKIP_CLEANUP", False):
                cmd.append("--skip-cleanup")
            if root.env_bool("JOB_RUNNER_SKIP_BUILD", False):
                cmd.append("--skip-build")
            roles = list(req.selected_roles or []) or roles_from_inventory
            if roles:
                cmd.append("--id")
                cmd.extend(roles)

        vars_path = inventory_path.with_name("vars.json")
        if vars_path.is_file():
            vars_arg = str(root.Path(inventory_arg).with_name("vars.json"))
            cmd.extend(["-e", f"@{vars_arg}"])

        extra_args_raw = (root.os.getenv("JOB_RUNNER_ANSIBLE_ARGS") or "").strip()
        if extra_args_raw:
            try:
                cmd.extend(root.shlex.split(extra_args_raw))
            except ValueError as exc:
                raise root.HTTPException(
                    status_code=500,
                    detail=f"invalid JOB_RUNNER_ANSIBLE_ARGS: {exc}",
                ) from exc

        return cmd

    def _build_direct_playbook_args(
        self, *, req, job_dir, inventory_arg: str, inventory_path
    ):
        root = _root()
        rel_path = str(req.playbook_path or "").strip().lstrip("/")
        if not rel_path:
            raise root.HTTPException(
                status_code=400, detail="playbook_path is required"
            )
        job_root = job_dir.resolve()
        playbook_host_path = (job_dir / rel_path).resolve()
        if playbook_host_path == job_root or job_root not in playbook_host_path.parents:
            raise root.HTTPException(status_code=400, detail="invalid playbook_path")
        if not playbook_host_path.is_file():
            raise root.HTTPException(status_code=400, detail="playbook_path not found")

        playbook_arg = (root.Path(inventory_arg).parent / rel_path).as_posix()
        cmd = ["ansible-playbook", "-i", inventory_arg, playbook_arg]
        if req.limit:
            cmd.extend(["-l", req.limit])
        return cmd

    def _remember_secrets(self, job_id: str, secrets: list[str]) -> None:
        if not secrets:
            return
        with self._secret_lock:
            self._secret_store[job_id] = secrets

    def get_secrets(self, job_id: str) -> list[str]:
        with self._secret_lock:
            return list(self._secret_store.get(job_id, []))

    def subscribe_logs(self, job_id: str, *, replay_buffer: bool = True):
        return self._log_hub.subscribe(job_id, replay_buffer=replay_buffer)

    def unsubscribe_logs(self, job_id: str, q) -> None:
        self._log_hub.unsubscribe(job_id, q)
