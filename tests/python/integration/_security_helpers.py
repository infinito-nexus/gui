"""Helpers extracted from test_security_hardening.py to keep the test file
under the 500-line repo-wide cap (enforced by `scripts/check-max-lines.sh`).
Behaviour is identical to the previously-inline definitions.
"""

from __future__ import annotations

import subprocess
import time

import httpx

from .perf_support import REPO_ROOT


STACK_SERVICES = (
    "api db catalog runner-manager web ssh-password cache-registry cache-package"
)
RUNNER_PLAYBOOK = """\
- hosts: all
  gather_facts: false
  tasks:
    - name: Emit runner-security start line
      ansible.builtin.debug:
        msg: "SECURITY-LINE start"
    - name: Hold the runner long enough for live inspection
      ansible.builtin.pause:
        seconds: 20
    - name: Emit runner-security end line
      ansible.builtin.debug:
        msg: "SECURITY-LINE end"
"""
SECRET_VALUE = "IntegrationSecret-4f3d2c1b0a"


def raise_for_status_verbose(response: httpx.Response) -> None:
    """raise_for_status that surfaces the response body in the error.

    The default httpx.HTTPStatusError only shows the status line, which
    swallows API error details on CI runs where containers are torn down
    before the workflow's dump-on-failure step can capture logs.
    """
    if response.is_success:
        return
    body = (response.text or "")[:4000]
    raise httpx.HTTPStatusError(
        f"{response.status_code} {response.request.method} {response.request.url}\nbody: {body}",
        request=response.request,
        response=response,
    )


def run_make(*args: str) -> None:
    subprocess.run(
        ["make", *args],
        cwd=str(REPO_ROOT),
        check=True,
        text=True,
    )


def docker_output(*args: str, check: bool = True) -> str:
    result = subprocess.run(
        ["docker", *args],
        cwd=str(REPO_ROOT),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        check=False,
    )
    if check and result.returncode != 0:
        raise AssertionError(
            f"docker {' '.join(args)} failed with rc={result.returncode}: {result.stderr}"
        )
    return str(result.stdout or "").strip()


def wait_for_http_ready(url: str, *, timeout_seconds: float = 60.0) -> None:
    deadline = time.monotonic() + timeout_seconds
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        try:
            with httpx.Client(timeout=5.0) as client:
                response = client.get(url)
            if response.status_code < 500:
                return
        except Exception as exc:  # pragma: no cover - integration only
            last_error = exc
        time.sleep(1.0)
    raise AssertionError(f"timed out waiting for {url}: {last_error}")
