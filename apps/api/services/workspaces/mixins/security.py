from __future__ import annotations

import subprocess
from typing import Any

from fastapi import HTTPException

from services.job_runner.util import atomic_write_text
from .security_connection import run_connection_test
from .vault_rotation import iter_yaml_files, rotate_vault_blocks_for_file
from ..vault import (
    _ensure_secrets_dirs,
    _generate_passphrase,
    _kdbx_path,
    _keys_dir,
    _open_kdbx,
    _read_kdbx_entry,
    _upsert_kdbx_entry,
    _vault_alias,
    _vault_entry_title,
    _vault_password_from_kdbx,
)


class WorkspaceServiceSecurityMixin:
    def set_vault_entries(
        self,
        workspace_id: str,
        *,
        master_password: str,
        master_password_confirm: str | None,
        create_if_missing: bool,
        alias: str | None,
        server_password: str | None,
        vault_password: str | None,
        key_passphrase: str | None,
    ) -> bool:
        with self.workspace_write_lock(workspace_id):
            root = self.ensure(workspace_id)
            changed_fields: list[str] = []
            kp = _open_kdbx(
                root,
                master_password,
                create_if_missing=create_if_missing,
                master_password_confirm=master_password_confirm,
            )
            if server_password is not None:
                _upsert_kdbx_entry(
                    kp, _vault_entry_title("server_password", alias), server_password
                )
                changed_fields.append("server_password")
            if vault_password is not None:
                _upsert_kdbx_entry(
                    kp, _vault_entry_title("vault_password"), vault_password
                )
                changed_fields.append("vault_password")
            if key_passphrase is not None:
                _upsert_kdbx_entry(
                    kp, _vault_entry_title("key_passphrase", alias), key_passphrase
                )
                changed_fields.append("key_passphrase")
            kp.save()
            if changed_fields:
                detail = ", ".join(changed_fields)
                self._history_commit(
                    root,
                    f"context: change vault value ({detail})",
                    metadata={"server": alias or ""},
                )
            return True

    def set_or_reset_vault_master_password(
        self,
        workspace_id: str,
        *,
        current_master_password: str | None,
        new_master_password: str,
        new_master_password_confirm: str,
    ) -> None:
        with self.workspace_write_lock(workspace_id):
            root = self.ensure(workspace_id)
            if new_master_password != new_master_password_confirm:
                raise HTTPException(
                    status_code=400,
                    detail="new master password confirmation mismatch",
                )
            if not new_master_password.strip():
                raise HTTPException(
                    status_code=400, detail="new master password is required"
                )

            vault_path = _kdbx_path(root)
            was_existing = vault_path.is_file()
            if not vault_path.is_file():
                _open_kdbx(
                    root,
                    new_master_password,
                    create_if_missing=True,
                    master_password_confirm=new_master_password,
                )
                self._history_commit(root, "context: set vault master password")
                return

            if not (current_master_password or "").strip():
                raise HTTPException(
                    status_code=400,
                    detail="current master password is required",
                )

            kp = _open_kdbx(
                root,
                current_master_password,
                create_if_missing=False,
                master_password_confirm=None,
            )
            kp.change_password(new_master_password)
            kp.save()
            if was_existing:
                self._history_commit(root, "context: reset vault master password")

    def change_vault_master_password(
        self,
        workspace_id: str,
        *,
        master_password: str,
        new_master_password: str,
        new_master_password_confirm: str,
    ) -> None:
        self.set_or_reset_vault_master_password(
            workspace_id=workspace_id,
            current_master_password=master_password,
            new_master_password=new_master_password,
            new_master_password_confirm=new_master_password_confirm,
        )

    def reset_vault_password(
        self,
        workspace_id: str,
        *,
        master_password: str,
        new_vault_password: str | None = None,
    ) -> dict[str, int]:
        with self.workspace_write_lock(workspace_id):
            root = self.ensure(workspace_id)
            kp = _open_kdbx(
                root,
                master_password,
                create_if_missing=False,
                master_password_confirm=None,
            )
            current_vault_password = _read_kdbx_entry(
                kp, _vault_entry_title("vault_password")
            )
            if not current_vault_password:
                raise HTTPException(status_code=400, detail="vault password not set")

            next_vault_password = (
                new_vault_password or ""
            ).strip() or _generate_passphrase()
            if next_vault_password == current_vault_password:
                raise HTTPException(
                    status_code=400, detail="new vault password must differ"
                )

            try:
                from ansible.parsing.vault import VaultLib, VaultSecret
            except Exception as exc:
                raise HTTPException(
                    status_code=500, detail=f"ansible vault unavailable: {exc}"
                ) from exc

            old_vault = VaultLib(
                secrets=[("default", VaultSecret(current_vault_password.encode()))]
            )
            new_vault = VaultLib(
                secrets=[("default", VaultSecret(next_vault_password.encode()))]
            )

            updated_files = 0
            updated_values = 0
            for file_path in iter_yaml_files(root):
                updated_content, replaced_blocks = rotate_vault_blocks_for_file(
                    file_path, old_vault, new_vault
                )
                if replaced_blocks <= 0:
                    continue
                atomic_write_text(file_path, updated_content)
                updated_files += 1
                updated_values += replaced_blocks

            _upsert_kdbx_entry(
                kp, _vault_entry_title("vault_password"), next_vault_password
            )
            kp.save()
            self._history_commit(root, "context: reset vault password")
            return {
                "updated_files": updated_files,
                "updated_values": updated_values,
            }

    def generate_ssh_keypair(
        self,
        workspace_id: str,
        *,
        alias: str,
        algorithm: str,
        with_passphrase: bool,
        master_password: str | None = None,
        master_password_confirm: str | None = None,
        return_passphrase: bool = False,
    ) -> dict[str, Any]:
        with self.workspace_write_lock(workspace_id):
            root = self.ensure(workspace_id)
            _ensure_secrets_dirs(root)

            safe_alias = _vault_alias(alias)
            key_dir = _keys_dir(root)
            key_private = key_dir / safe_alias
            key_public = key_dir / f"{safe_alias}.pub"

            if key_private.exists():
                try:
                    key_private.unlink()
                except Exception:
                    pass
            if key_public.exists():
                try:
                    key_public.unlink()
                except Exception:
                    pass

            algo = (algorithm or "ed25519").lower().strip()
            if algo not in {"ed25519", "rsa", "ecdsa"}:
                raise HTTPException(status_code=400, detail="unsupported ssh algorithm")

            passphrase = ""
            if with_passphrase:
                if not master_password:
                    raise HTTPException(
                        status_code=400, detail="master_password is required"
                    )
                passphrase = _generate_passphrase()

            command = [
                "ssh-keygen",
                "-t",
                algo,
                "-f",
                str(key_private),
                "-N",
                passphrase,
                "-q",
            ]
            if algo == "rsa":
                command.extend(["-b", "4096"])
            comment = (alias or "").strip()
            if comment:
                command.extend(["-C", comment])

            result = subprocess.run(
                command, capture_output=True, text=True, check=False
            )
            if result.returncode != 0 or not key_private.exists():
                raise HTTPException(status_code=500, detail="ssh-keygen failed")

            try:
                key_private.chmod(0o600)
            except Exception:
                pass

            private_key = key_private.read_text(encoding="utf-8", errors="replace")
            public_key = key_public.read_text(encoding="utf-8", errors="replace")

            if with_passphrase:
                kp = _open_kdbx(
                    root,
                    master_password or "",
                    create_if_missing=True,
                    master_password_confirm=master_password_confirm,
                )
                _upsert_kdbx_entry(
                    kp, _vault_entry_title("key_passphrase", alias), passphrase
                )
                kp.save()

            response: dict[str, Any] = {
                "private_key": private_key,
                "public_key": public_key,
                "key_path": key_private.relative_to(root).as_posix(),
                "public_key_path": key_public.relative_to(root).as_posix(),
            }
            if with_passphrase and return_passphrase:
                response["passphrase"] = passphrase
            self._history_commit(
                root,
                f"context: generate ssh key ({safe_alias})",
                metadata={"server": alias},
            )
            return response

    def change_key_passphrase(
        self,
        workspace_id: str,
        *,
        alias: str,
        master_password: str,
        new_passphrase: str,
        new_passphrase_confirm: str,
    ) -> None:
        with self.workspace_write_lock(workspace_id):
            if new_passphrase != new_passphrase_confirm:
                raise HTTPException(
                    status_code=400, detail="new passphrase confirmation mismatch"
                )

            root = self.ensure(workspace_id)
            key_private = _keys_dir(root) / _vault_alias(alias)
            if not key_private.is_file():
                raise HTTPException(status_code=404, detail="private key not found")

            kp = _open_kdbx(
                root,
                master_password,
                create_if_missing=False,
                master_password_confirm=None,
            )
            old_passphrase = _read_kdbx_entry(
                kp, _vault_entry_title("key_passphrase", alias)
            )

            command = [
                "ssh-keygen",
                "-p",
                "-f",
                str(key_private),
                "-P",
                old_passphrase or "",
                "-N",
                new_passphrase,
            ]
            result = subprocess.run(
                command, capture_output=True, text=True, check=False
            )
            if result.returncode != 0:
                raise HTTPException(
                    status_code=500, detail="failed to update passphrase"
                )

            _upsert_kdbx_entry(
                kp, _vault_entry_title("key_passphrase", alias), new_passphrase
            )
            kp.save()
            self._history_commit(
                root,
                f"context: change key passphrase ({_vault_alias(alias)})",
                metadata={"server": alias},
            )

    def vault_decrypt(
        self, workspace_id: str, *, master_password: str, vault_text: str
    ) -> str:
        root = self.ensure(workspace_id)
        vault_password = _vault_password_from_kdbx(root, master_password)
        raw = (vault_text or "").strip()
        if not raw:
            raise HTTPException(status_code=400, detail="vault_text is required")
        try:
            from ansible.parsing.vault import VaultLib, VaultSecret
        except Exception as exc:
            raise HTTPException(
                status_code=500, detail=f"ansible vault unavailable: {exc}"
            ) from exc
        vault = VaultLib(secrets=[("default", VaultSecret(vault_password.encode()))])
        try:
            decrypted = vault.decrypt(raw.encode("utf-8"))
        except Exception as exc:
            raise HTTPException(
                status_code=400, detail="vault decryption failed"
            ) from exc
        return decrypted.decode("utf-8", errors="replace")

    def vault_encrypt(
        self, workspace_id: str, *, master_password: str, plaintext: str
    ) -> str:
        root = self.ensure(workspace_id)
        vault_password = _vault_password_from_kdbx(root, master_password)
        if plaintext is None:
            raise HTTPException(status_code=400, detail="plaintext is required")
        try:
            from ansible.parsing.vault import VaultLib, VaultSecret
        except Exception as exc:
            raise HTTPException(
                status_code=500, detail=f"ansible vault unavailable: {exc}"
            ) from exc
        vault = VaultLib(secrets=[("default", VaultSecret(vault_password.encode()))])
        try:
            encrypted = vault.encrypt(plaintext.encode("utf-8"))
        except Exception as exc:
            raise HTTPException(
                status_code=400, detail="vault encryption failed"
            ) from exc
        return encrypted.decode("utf-8", errors="replace")

    def test_connection(
        self,
        *,
        host: str,
        port: int | None,
        user: str,
        auth_method: str,
        password: str | None,
        private_key: str | None,
        key_passphrase: str | None,
        timeout: int = 6,
    ) -> dict[str, Any]:
        return run_connection_test(
            host=host,
            port=port,
            user=user,
            auth_method=auth_method,
            password=password,
            private_key=private_key,
            key_passphrase=key_passphrase,
            timeout=timeout,
        )
