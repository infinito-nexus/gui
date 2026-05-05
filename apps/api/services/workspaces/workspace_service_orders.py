"""Workspace orders service mixin.

Order placement saves the customer-facing checkout payload (contact +
billing + cart items) under `workspace/<id>/orders/<order_id>.yml`,
links it to the workspace's owner if authenticated, and — for
anonymous orders — auto-creates a workspace user in
`group_vars/all.yml` from the contact info so subsequent deployments
can reference the customer.
"""

from __future__ import annotations

import re
import uuid
from pathlib import Path
from typing import Any

import yaml
from fastapi import HTTPException

from services.job_runner.util import atomic_write_text, safe_mkdir
from .workspace_context import _load_meta, _now_iso, _write_meta

_USERNAME_FALLBACK_RE = re.compile(r"[^a-z0-9]+")


def _new_order_id() -> str:
    return str(uuid.uuid4())


def _slugify_username(seed: str) -> str:
    """Derive a workspace-user-safe slug from an email or full name.

    Workspace usernames must match `[a-z0-9]+` (USERNAME_PATTERN in
    users-utils on the web side). We collapse anything else so a
    contact like "Alice Smith <alice.smith@example.com>" lands as
    "alicesmith".
    """
    cleaned = (seed or "").strip().lower()
    if "@" in cleaned:
        cleaned = cleaned.split("@", 1)[0]
    cleaned = _USERNAME_FALLBACK_RE.sub("", cleaned)
    return cleaned[:32]


def _split_full_name(full_name: str) -> tuple[str, str]:
    parts = (full_name or "").strip().split()
    if not parts:
        return "", ""
    if len(parts) == 1:
        return parts[0], ""
    return parts[0], " ".join(parts[1:])


class WorkspaceServiceOrdersMixin:
    def _orders_dir(self, workspace_id: str) -> Path:
        root: Path = self.ensure(workspace_id)  # type: ignore[attr-defined]
        path = root / "orders"
        safe_mkdir(path)
        return path

    def _ensure_workspace_user_for_order(
        self,
        workspace_id: str,
        full_name: str,
        email: str,
    ) -> str:
        """Add a user to `group_vars/all.yml` from order contact info.

        Used only when the order arrives without an authenticated
        owner — gives the workspace a record of who placed it so
        deployments can target that user. Returns the username.
        Idempotent: if a user with the same username already exists,
        we keep the existing entry untouched and return its username.
        """
        username = _slugify_username(email or full_name)
        if not username:
            return ""

        root: Path = self.ensure(workspace_id)  # type: ignore[attr-defined]
        all_yml = root / "group_vars" / "all.yml"
        safe_mkdir(all_yml.parent)

        existing: dict[str, Any] = {}
        if all_yml.is_file():
            try:
                existing = yaml.safe_load(all_yml.read_text(encoding="utf-8")) or {}
                if not isinstance(existing, dict):
                    existing = {}
            except Exception:
                existing = {}

        users_node = existing.get("users")
        users_map: dict[str, Any] = {}
        if isinstance(users_node, dict):
            users_map = dict(users_node)
        elif isinstance(users_node, list):
            for entry in users_node:
                if isinstance(entry, dict) and entry.get("username"):
                    users_map[str(entry["username"])] = dict(entry)

        if username in users_map:
            return username

        first, last = _split_full_name(full_name)
        users_map[username] = {
            "username": username,
            "firstname": first,
            "lastname": last,
            "email": (email or "").strip(),
        }
        existing["users"] = users_map
        try:
            atomic_write_text(all_yml, yaml.safe_dump(existing, sort_keys=False))
        except Exception as exc:
            raise HTTPException(
                status_code=500,
                detail=f"failed to write group_vars/all.yml: {exc}",
            ) from exc
        return username

    def place_order(
        self,
        workspace_id: str,
        payload: dict[str, Any],
        *,
        owner_id: str | None,
        owner_email: str | None,
    ) -> dict[str, Any]:
        """Persist a customer order to the workspace's orders/ tree.

        - Authenticated: the order's `owner_user_id` is the auth
          context's user_id, no workspace user is created (the user
          already has a platform identity).
        - Anonymous: a workspace user is auto-created in
          `group_vars/all.yml` from `full_name` + `email` so the
          order has a stable username to reference.
        """
        full_name = str(payload.get("full_name") or "").strip()
        email = str(payload.get("email") or "").strip()
        if not full_name:
            raise HTTPException(status_code=400, detail="full_name is required")
        if not email:
            raise HTTPException(status_code=400, detail="email is required")
        items = payload.get("items")
        if not isinstance(items, list) or not items:
            raise HTTPException(
                status_code=400,
                detail="items must be a non-empty list of order entries",
            )

        with self.workspace_write_lock(workspace_id):
            orders_dir = self._orders_dir(workspace_id)
            order_id = _new_order_id()
            now = _now_iso()

            actor_id = (owner_id or "").strip() or None
            workspace_username = ""
            if not actor_id:
                workspace_username = self._ensure_workspace_user_for_order(
                    workspace_id, full_name, email
                )

            record: dict[str, Any] = {
                "order_id": order_id,
                "workspace_id": workspace_id,
                "created_at": now,
                "owner_user_id": actor_id,
                "owner_email": owner_email or email,
                "workspace_username": workspace_username or None,
                "contact": {
                    "full_name": full_name,
                    "email": email,
                    "company": str(payload.get("company") or "").strip() or None,
                    "phone": str(payload.get("phone") or "").strip() or None,
                },
                "billing_address": {
                    "street": str(payload.get("street") or "").strip() or None,
                    "postal_code": str(payload.get("postal_code") or "").strip()
                    or None,
                    "city": str(payload.get("city") or "").strip() or None,
                    "country": str(payload.get("country") or "").strip() or None,
                    "vat_id": str(payload.get("vat_id") or "").strip() or None,
                },
                "billing": {
                    "cycle": str(payload.get("billing_cycle") or "monthly"),
                    "payment_method": str(payload.get("payment_method") or "invoice"),
                },
                "notes": str(payload.get("notes") or "").strip() or None,
                "items": items,
                "terms_accepted": bool(payload.get("terms_accepted")),
            }

            target = orders_dir / f"{order_id}.yml"
            try:
                atomic_write_text(target, yaml.safe_dump(record, sort_keys=False))
            except Exception as exc:
                raise HTTPException(
                    status_code=500,
                    detail=f"failed to write order file: {exc}",
                ) from exc

            # Stamp the workspace meta so list views can show "last
            # ordered at" without enumerating the orders/ dir.
            try:
                root: Path = self.ensure(workspace_id)  # type: ignore[attr-defined]
                meta = _load_meta(root)
                meta["last_order_at"] = now
                meta["updated_at"] = now
                _write_meta(root, meta)
            except Exception:
                # Meta-stamp is best-effort; the order itself is the
                # primary record so a meta-write hiccup doesn't fail
                # the request.
                pass

            return {
                "order_id": order_id,
                "created_at": now,
                "owner_user_id": actor_id,
                "workspace_username": workspace_username or None,
            }

    def list_orders(self, workspace_id: str) -> list[dict[str, Any]]:
        """Return every order on the workspace, newest first.

        Reads each `orders/<id>.yml` and surfaces a small subset of
        fields suitable for a list view (the full record is fetched
        on demand by the future detail endpoint).
        """
        try:
            root: Path = self.ensure(workspace_id)  # type: ignore[attr-defined]
        except HTTPException:
            return []
        orders_dir = root / "orders"
        if not orders_dir.is_dir():
            return []
        out: list[dict[str, Any]] = []
        for child in orders_dir.iterdir():
            if not child.is_file() or child.suffix != ".yml":
                continue
            try:
                data = yaml.safe_load(child.read_text(encoding="utf-8")) or {}
            except Exception:
                continue
            if not isinstance(data, dict):
                continue
            out.append(
                {
                    "order_id": str(data.get("order_id") or child.stem),
                    "created_at": str(data.get("created_at") or ""),
                    "owner_user_id": data.get("owner_user_id"),
                    "workspace_username": data.get("workspace_username"),
                    "items_count": len(data.get("items") or [])
                    if isinstance(data.get("items"), list)
                    else 0,
                }
            )
        out.sort(key=lambda entry: entry.get("created_at") or "", reverse=True)
        return out
