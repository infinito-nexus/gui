from __future__ import annotations

import importlib


def _root():
    return importlib.import_module("services.job_runner.service")


class JobRunnerServiceWorkspaceMixin:
    def __init__(self) -> None:
        root = _root()
        root.safe_mkdir(root.jobs_root())
        self._purge_orphaned_secret_material()
        self._secret_lock = root.threading.Lock()
        self._secret_store: dict[str, list[str]] = {}
        self._log_hub = root.LogHub()

    def _runner_manager_enabled(self) -> bool:
        return _root().RunnerManagerClient().enabled()

    def _runner_manager_client(self):
        return _root().RunnerManagerClient()

    def _cleanup_secret_material(self, paths) -> None:
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

    def _watch_managed_job_cleanup(self, job_id: str) -> None:
        root = _root()
        terminal_statuses = {"succeeded", "failed", "canceled"}
        paths = root.job_paths(job_id)
        while paths.job_dir.is_dir():
            meta = root.load_json(paths.meta_path)
            status = str(meta.get("status") or "").strip().lower()
            if status in terminal_statuses:
                self._cleanup_secret_material(paths)
                root._release_process_memory()
                return
            root.time.sleep(0.5)

    def _purge_orphaned_secret_material(self) -> None:
        root = _root()
        for job_dir in sorted(root.jobs_root().iterdir() if root.jobs_root().exists() else []):
            if not job_dir.is_dir():
                continue
            paths = root.job_paths(job_dir.name)
            meta = root.load_json(paths.meta_path)
            status = str(meta.get("status") or "").strip().lower()
            pid = meta.get("pid")
            pid_running = isinstance(pid, int) and self._pid_is_running(pid)
            if status == "running" and pid_running:
                continue
            self._cleanup_secret_material(paths)

    def _pid_is_running(self, pid: int) -> bool:
        try:
            _root().os.kill(int(pid), 0)
        except Exception:
            return False
        return True

    def _copy_workspace_files(self, workspace_id: str, dest_root) -> None:
        root = _root()
        svc = root.WorkspaceService()
        src_root = svc.ensure(workspace_id)
        inventory_path = src_root / "inventory.yml"
        if not inventory_path.is_file():
            raise root.HTTPException(
                status_code=400,
                detail="workspace inventory.yml not found",
            )

        for dirpath, dirnames, filenames in root.os.walk(src_root):
            rel = root.Path(dirpath).relative_to(src_root)
            target_dir = dest_root / rel
            root.safe_mkdir(target_dir)
            dirnames[:] = [
                dirname
                for dirname in dirnames
                if not dirname.startswith(".") and dirname != "secrets"
            ]
            for filename in filenames:
                if filename.startswith(".") or filename in root.WORKSPACE_SKIP_FILES:
                    continue
                src = root.Path(dirpath) / filename
                dst = target_dir / filename
                root.shutil.copy2(src, dst)

    def _roles_from_inventory(self, inventory_path) -> list[str]:
        root = _root()
        try:
            raw = inventory_path.read_text(encoding="utf-8", errors="replace")
            data = root.yaml.safe_load(raw) or {}
            children = (data or {}).get("all", {}).get("children", {})
            if isinstance(children, dict):
                return [str(key).strip() for key in children.keys() if str(key).strip()]
        except Exception:
            return []
        return []

    def _resolve_domain_primary(self, workspace_root) -> str:
        root = _root()
        candidates = [
            workspace_root / "group_vars" / "all.yml",
            *sorted((workspace_root / "host_vars").glob("*.yml")),
        ]
        for path in candidates:
            try:
                loaded = root.yaml.safe_load(
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
            root.os.getenv("DOMAIN_PRIMARY") or root.os.getenv("DOMAIN") or ""
        ).strip()
        return env_domain or "infinito.localhost"

    def _inventory_host_aliases(self, inventory_path) -> list[str]:
        root = _root()
        try:
            loaded = root.yaml.safe_load(
                inventory_path.read_text(encoding="utf-8", errors="replace")
            )
        except Exception:
            return []
        data = loaded if isinstance(loaded, dict) else {}
        aliases: list[str] = []
        seen: set[str] = set()

        def append_mapping_hosts(hosts) -> None:
            if not isinstance(hosts, dict):
                return
            for alias in hosts.keys():
                normalized = str(alias).strip()
                if normalized and normalized not in seen:
                    seen.add(normalized)
                    aliases.append(normalized)

        all_node = data.get("all") or {}
        if isinstance(all_node, dict):
            append_mapping_hosts(all_node.get("hosts"))
            children = all_node.get("children") or {}
            if isinstance(children, dict):
                for child in children.values():
                    if isinstance(child, dict):
                        append_mapping_hosts(child.get("hosts"))

        return aliases

    def _job_host_aliases(self, job_dir) -> list[str]:
        host_vars_dir = job_dir / "host_vars"
        existing_host_vars = [
            path.stem for path in sorted(host_vars_dir.glob("*.yml")) if path.is_file()
        ]
        if existing_host_vars:
            return existing_host_vars
        return self._inventory_host_aliases(job_dir / "inventory.yml")

    def _inject_related_domains(self, req, job_dir) -> None:
        root = _root()
        selected_roles = [str(role_id).strip() for role_id in req.selected_roles if role_id]
        if not selected_roles:
            return
        related_domains = root.discover_related_role_domains(
            selected_roles=selected_roles,
            domain_primary=self._resolve_domain_primary(job_dir),
        )
        if not related_domains:
            return

        host_vars_dir = job_dir / "host_vars"
        root.safe_mkdir(host_vars_dir)
        host_aliases = self._job_host_aliases(job_dir) or ["target"]
        for alias in host_aliases:
            host_vars_path = host_vars_dir / f"{alias}.yml"
            loaded: dict[str, object] = {}
            if host_vars_path.is_file():
                try:
                    loaded_raw = root.load_workspace_yaml_document(
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
            root.atomic_write_text(
                host_vars_path,
                root.yaml.dump(
                    loaded,
                    Dumper=root._WorkspaceYamlDumper,
                    sort_keys=False,
                    default_flow_style=False,
                    allow_unicode=True,
                ),
            )

    def _write_runner_identity_shims(self, paths) -> None:
        root = _root()
        root.atomic_write_text(paths.passwd_path, root.RUNNER_PASSWD)
        root.atomic_write_text(paths.group_path, root.RUNNER_GROUP)
        root.atomic_write_text(paths.sudoers_path, root.RUNNER_SUDOERS)
        paths.passwd_path.chmod(0o644)
        paths.group_path.chmod(0o644)
        paths.sudoers_path.chmod(0o440)

    def _merge_nested_mappings(self, base, override):
        root = _root()
        merged = root.copy.deepcopy(base)
        for key, value in override.items():
            existing = merged.get(key)
            if isinstance(existing, dict) and isinstance(value, dict):
                merged[key] = self._merge_nested_mappings(existing, value)
            else:
                merged[key] = root.copy.deepcopy(value)
        return merged

    def _materialize_workspace_group_vars_into_host_vars(self, job_dir) -> None:
        root = _root()
        workspace_group_vars = job_dir / "group_vars" / "all.yml"
        if not workspace_group_vars.is_file():
            return

        loaded_raw = root.load_workspace_yaml_document(
            workspace_group_vars.read_text(encoding="utf-8", errors="replace")
        )
        if loaded_raw is None:
            return
        if not isinstance(loaded_raw, dict):
            raise root.HTTPException(
                status_code=400,
                detail="workspace group_vars/all.yml must contain a YAML mapping",
            )

        workspace_overrides = {
            key: value
            for key in root.WORKSPACE_HOST_VAR_OVERRIDE_KEYS
            for value in [loaded_raw.get(key)]
            if isinstance(value, dict) and value
        }
        if not workspace_overrides:
            return

        host_vars_dir = job_dir / "host_vars"
        root.safe_mkdir(host_vars_dir)
        host_aliases = self._job_host_aliases(job_dir)
        if not host_aliases:
            return

        for alias in host_aliases:
            host_vars_path = host_vars_dir / f"{alias}.yml"
            existing_host_vars: dict[str, object] = {}
            if host_vars_path.is_file():
                try:
                    existing_raw = root.load_workspace_yaml_document(
                        host_vars_path.read_text(encoding="utf-8", errors="replace")
                    )
                except Exception:
                    existing_raw = {}
                existing_host_vars = existing_raw if isinstance(existing_raw, dict) else {}

            for key, workspace_value in workspace_overrides.items():
                existing_value = existing_host_vars.get(key)
                if isinstance(existing_value, dict) and existing_value:
                    existing_host_vars[key] = self._merge_nested_mappings(
                        workspace_value,
                        existing_value,
                    )
                else:
                    existing_host_vars[key] = root.copy.deepcopy(workspace_value)
            root.atomic_write_text(
                host_vars_path,
                root.yaml.dump(
                    existing_host_vars,
                    Dumper=root._WorkspaceYamlDumper,
                    sort_keys=False,
                    default_flow_style=False,
                    allow_unicode=True,
                ),
            )
