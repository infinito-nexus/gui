from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List

import yaml
from fastapi import HTTPException

from services.job_runner.util import atomic_write_json, safe_mkdir, utc_iso
from services.workspaces import WorkspaceService


def _sanitize_alias(alias: str) -> str:
    cleaned = "".join(ch for ch in alias if ch.isalnum() or ch in {"-", "_", "."})
    return cleaned.strip() or "server"


def _load_json(path: Path) -> Dict[str, Any]:
    if not path.is_file():
        return {}
    try:
        loaded = json.loads(path.read_text(encoding="utf-8"))
        return loaded if isinstance(loaded, dict) else {}
    except Exception:
        return {}


def _load_yaml(path: Path) -> Dict[str, Any]:
    if not path.is_file():
        return {}
    try:
        loaded = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        return loaded if isinstance(loaded, dict) else {}
    except Exception:
        return {}


class UsersService:
    def __init__(self) -> None:
        self._workspaces = WorkspaceService()

    def _workspace_root(self, workspace_id: str) -> Path:
        return self._workspaces.ensure(workspace_id)

    def _meta(self, root: Path) -> Dict[str, Any]:
        return _load_json(root / "workspace.json")

    def _inventory_roles(self, root: Path) -> Dict[str, List[str]]:
        inventory = _load_yaml(root / "inventory.yml")
        children = (
            inventory.get("all", {}).get("children", {})
            if isinstance(inventory.get("all"), dict)
            else {}
        )
        out: Dict[str, List[str]] = {}
        if not isinstance(children, dict):
            return out
        for role_id, role_node in children.items():
            role_key = str(role_id or "").strip()
            if not role_key:
                continue
            hosts = role_node.get("hosts", {}) if isinstance(role_node, dict) else {}
            aliases = []
            if isinstance(hosts, dict):
                for alias in hosts.keys():
                    alias_key = str(alias or "").strip()
                    if alias_key:
                        aliases.append(alias_key)
            out[role_key] = sorted(set(aliases))
        return out

    def _server_connection_ready(self, root: Path, alias: str) -> bool:
        host_vars_path = root / "host_vars" / f"{_sanitize_alias(alias)}.yml"
        data = _load_yaml(host_vars_path)
        if not isinstance(data, dict):
            return False
        host = str(data.get("ansible_host") or "").strip()
        user = str(data.get("ansible_user") or "").strip()
        return bool(host and user)

    def eligibility(self, workspace_id: str) -> Dict[str, Any]:
        root = self._workspace_root(workspace_id)
        meta = self._meta(root)
        roles = self._inventory_roles(root)

        setup_state = str(meta.get("state") or "").strip().lower()
        setup_completed = setup_state in {"deployed", "finished"}
        keycloak_aliases = roles.get("web-app-keycloak", [])

        ldap_present = any("ldap" in role_id for role_id in roles.keys()) or bool(
            keycloak_aliases
        )
        reachable_servers = [
            alias
            for alias in keycloak_aliases
            if self._server_connection_ready(root, alias)
        ]

        reasons: List[str] = []
        if not setup_completed:
            reasons.append("setup not completed")
        if not keycloak_aliases:
            reasons.append("no keycloak-enabled server found")
        if not ldap_present:
            reasons.append("ldap backend not detected")
        if keycloak_aliases and not reachable_servers:
            reasons.append("ssh connection details are missing")

        return {
            "can_manage": len(reasons) == 0,
            "setup_completed": setup_completed,
            "ldap_present": ldap_present,
            "keycloak_servers": keycloak_aliases,
            "reachable_servers": reachable_servers,
            "reasons": reasons,
        }

    def _ensure_server_eligible(self, workspace_id: str, server_id: str) -> Path:
        root = self._workspace_root(workspace_id)
        alias = str(server_id or "").strip()
        if not alias:
            raise HTTPException(status_code=400, detail="server_id is required")
        info = self.eligibility(workspace_id)
        if not info.get("can_manage"):
            raise HTTPException(
                status_code=400,
                detail=(
                    "User management requires an active deployed server "
                    "with Keycloak and LDAP."
                ),
            )
        if alias not in info.get("keycloak_servers", []):
            raise HTTPException(status_code=400, detail="server is not LDAP-eligible")
        if alias not in info.get("reachable_servers", []):
            raise HTTPException(status_code=400, detail="ssh connectivity not ready")
        return root

    def _users_file(self, root: Path, server_id: str) -> Path:
        users_dir = root / "users"
        safe_mkdir(users_dir)
        return users_dir / f"{_sanitize_alias(server_id)}.json"

    def _load_users(self, root: Path, server_id: str) -> Dict[str, Dict[str, Any]]:
        path = self._users_file(root, server_id)
        data = _load_json(path)
        users = data.get("users")
        if not isinstance(users, dict):
            return {}
        out: Dict[str, Dict[str, Any]] = {}
        for key, value in users.items():
            username = str(key or "").strip()
            if not username or not isinstance(value, dict):
                continue
            out[username] = dict(value)
        return out

    def _save_users(
        self, root: Path, server_id: str, users: Dict[str, Dict[str, Any]]
    ) -> None:
        path = self._users_file(root, server_id)
        payload = {
            "server_id": server_id,
            "updated_at": utc_iso(),
            "users": users,
        }
        atomic_write_json(path, payload)

    def list_users(self, workspace_id: str, server_id: str) -> List[Dict[str, Any]]:
        root = self._ensure_server_eligible(workspace_id, server_id)
        users = self._load_users(root, server_id)
        out: List[Dict[str, Any]] = []
        for username in sorted(users.keys()):
            user = users[username]
            out.append(
                {
                    "username": username,
                    "firstname": str(user.get("firstname") or ""),
                    "lastname": str(user.get("lastname") or ""),
                    "email": str(user.get("email") or ""),
                    "roles": sorted(
                        {
                            str(role).strip()
                            for role in user.get("roles", [])
                            if str(role).strip()
                        }
                    ),
                    "enabled": bool(user.get("enabled", True)),
                    "updated_at": str(user.get("updated_at") or ""),
                }
            )
        return out

    def create_user(
        self,
        workspace_id: str,
        server_id: str,
        *,
        username: str,
        firstname: str,
        lastname: str,
        email: str,
        password: str,
        roles: List[str],
        enabled: bool = True,
    ) -> Dict[str, Any]:
        root = self._ensure_server_eligible(workspace_id, server_id)
        user_name = str(username or "").strip()
        if not user_name:
            raise HTTPException(status_code=400, detail="username is required")
        if not str(password or ""):
            raise HTTPException(status_code=400, detail="password is required")
        users = self._load_users(root, server_id)
        if user_name in users:
            raise HTTPException(status_code=409, detail="username already exists")

        users[user_name] = {
            "firstname": str(firstname or "").strip(),
            "lastname": str(lastname or "").strip(),
            "email": str(email or "").strip(),
            "roles": [str(role).strip() for role in roles if str(role).strip()],
            "enabled": bool(enabled),
            # Never persist plaintext passwords.
            "password_set": True,
            "password_updated_at": utc_iso(),
            "updated_at": utc_iso(),
        }
        self._save_users(root, server_id, users)
        return {"ok": True}

    def change_password(
        self,
        workspace_id: str,
        server_id: str,
        *,
        username: str,
        new_password: str,
    ) -> Dict[str, Any]:
        root = self._ensure_server_eligible(workspace_id, server_id)
        if not str(new_password or ""):
            raise HTTPException(status_code=400, detail="new password is required")
        user_name = str(username or "").strip()
        users = self._load_users(root, server_id)
        user = users.get(user_name)
        if not user:
            raise HTTPException(status_code=404, detail="user not found")

        user["password_set"] = True
        user["password_updated_at"] = utc_iso()
        user["updated_at"] = utc_iso()
        users[user_name] = user
        self._save_users(root, server_id, users)
        return {"ok": True}

    def update_roles(
        self,
        workspace_id: str,
        server_id: str,
        *,
        username: str,
        roles: List[str],
        enabled: bool | None,
    ) -> Dict[str, Any]:
        root = self._ensure_server_eligible(workspace_id, server_id)
        user_name = str(username or "").strip()
        users = self._load_users(root, server_id)
        user = users.get(user_name)
        if not user:
            raise HTTPException(status_code=404, detail="user not found")
        user["roles"] = [str(role).strip() for role in roles if str(role).strip()]
        if enabled is not None:
            user["enabled"] = bool(enabled)
        user["updated_at"] = utc_iso()
        users[user_name] = user
        self._save_users(root, server_id, users)
        return {"ok": True}

    def delete_user(
        self, workspace_id: str, server_id: str, *, username: str
    ) -> Dict[str, Any]:
        root = self._ensure_server_eligible(workspace_id, server_id)
        user_name = str(username or "").strip()
        users = self._load_users(root, server_id)
        if user_name not in users:
            raise HTTPException(status_code=404, detail="user not found")
        users.pop(user_name, None)
        self._save_users(root, server_id, users)
        return {"ok": True}
