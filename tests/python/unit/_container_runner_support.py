import os
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
from fastapi import HTTPException
from services.job_runner.container_runner import (
    ContainerRunnerConfig,
    build_container_command,
    create_internal_network,
    inspect_container_labels,
    load_container_config,
    remove_network,
    stop_container,
)


def _make_cfg(**overrides) -> ContainerRunnerConfig:
    defaults = dict(
        image="infinito-arch",
        repo_dir="/opt/src/infinito",
        workdir="/workspace",
        network=None,
        extra_args=[],
        skip_cleanup=False,
        skip_build=False,
    )
    defaults.update(overrides)
    return ContainerRunnerConfig(**defaults)


__all__ = [
    "os",
    "unittest",
    "Path",
    "TemporaryDirectory",
    "patch",
    "HTTPException",
    "ContainerRunnerConfig",
    "build_container_command",
    "create_internal_network",
    "inspect_container_labels",
    "load_container_config",
    "remove_network",
    "stop_container",
    "_make_cfg",
    "ContainerRunnerTestCase",
]


class ContainerRunnerTestCase(unittest.TestCase):
    pass
