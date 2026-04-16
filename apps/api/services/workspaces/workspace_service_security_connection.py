from __future__ import annotations

import subprocess
from io import StringIO
from typing import Any

from fastapi import HTTPException


def run_connection_test(
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
    ping_ok = False
    ping_error: str | None = None
    ssh_ok = False
    ssh_error: str | None = None

    if host:
        try:
            ping = subprocess.run(
                ["ping", "-c", "1", "-W", "2", host],
                capture_output=True,
                text=True,
                check=False,
            )
            ping_ok = ping.returncode == 0
            if not ping_ok:
                ping_error = (ping.stderr or ping.stdout or "ping failed").strip()
        except Exception as exc:
            ping_ok = False
            ping_error = str(exc)

    try:
        import paramiko
    except Exception as exc:
        return {
            "ping_ok": ping_ok,
            "ping_error": ping_error,
            "ssh_ok": False,
            "ssh_error": f"paramiko unavailable: {exc}",
        }

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        connect_kwargs: dict[str, Any] = {
            "hostname": host,
            "username": user,
            "timeout": timeout,
            "allow_agent": False,
            "look_for_keys": False,
        }
        if port:
            connect_kwargs["port"] = port

        if auth_method == "password":
            client.connect(**connect_kwargs, password=password or "")
        else:
            if not private_key:
                raise HTTPException(status_code=400, detail="private key is required")

            key_obj = None
            key_buffer = StringIO(private_key)
            for key_class in [
                paramiko.Ed25519Key,
                paramiko.RSAKey,
                paramiko.ECDSAKey,
                paramiko.DSSKey,
            ]:
                key_buffer.seek(0)
                try:
                    key_obj = key_class.from_private_key(
                        key_buffer, password=key_passphrase
                    )
                    break
                except Exception:
                    continue
            if key_obj is None:
                raise HTTPException(
                    status_code=400, detail="failed to load private key"
                )

            client.connect(**connect_kwargs, pkey=key_obj)
        ssh_ok = True
    except HTTPException as exc:
        ssh_error = str(exc.detail)
    except Exception as exc:
        ssh_error = str(exc)
    finally:
        try:
            client.close()
        except Exception:
            pass

    return {
        "ping_ok": ping_ok,
        "ping_error": ping_error,
        "ssh_ok": ssh_ok,
        "ssh_error": ssh_error,
    }
