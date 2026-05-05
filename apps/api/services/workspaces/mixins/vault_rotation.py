from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from fastapi import HTTPException

from .context import _VAULT_BLOCK_START_RE


def iter_yaml_files(root: Path) -> list[Path]:
    files: list[Path] = []
    for dirpath, _dirnames, filenames in os.walk(root):
        current_dir = Path(dirpath)
        for filename in filenames:
            if filename == "workspace.json":
                continue
            file_path = current_dir / filename
            if file_path.suffix.lower() in {".yml", ".yaml"}:
                files.append(file_path)
    return files


def rotate_vault_blocks_for_file(
    path: Path, old_vault: Any, new_vault: Any
) -> tuple[str, int]:
    source = path.read_text(encoding="utf-8", errors="replace")
    had_trailing_newline = source.endswith("\n")
    lines = source.splitlines()
    output: list[str] = []
    replaced_blocks = 0
    index = 0

    while index < len(lines):
        line = lines[index]
        match = _VAULT_BLOCK_START_RE.match(line)
        if not match:
            output.append(line)
            index += 1
            continue

        base_indent = len(match.group(1))
        cursor = index + 1
        block_indent: int | None = None
        while cursor < len(lines):
            candidate = lines[cursor]
            if not candidate.strip():
                cursor += 1
                continue
            candidate_indent = len(candidate) - len(candidate.lstrip(" "))
            if candidate_indent <= base_indent:
                break
            if block_indent is None:
                block_indent = candidate_indent
            elif candidate_indent < block_indent:
                break
            cursor += 1

        if block_indent is None:
            output.append(line)
            index += 1
            continue

        block_lines = lines[index + 1 : cursor]
        normalized_lines: list[str] = []
        for block_line in block_lines:
            if not block_line.strip():
                normalized_lines.append("")
            elif len(block_line) >= block_indent:
                normalized_lines.append(block_line[block_indent:])
            else:
                normalized_lines.append(block_line.lstrip())

        vault_text = "\n".join(normalized_lines).strip()
        if not vault_text.startswith("$ANSIBLE_VAULT;"):
            output.append(line)
            output.extend(block_lines)
            index = cursor
            continue

        try:
            plaintext = old_vault.decrypt(vault_text.encode("utf-8")).decode(
                "utf-8", errors="replace"
            )
        except Exception as exc:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"failed to decrypt vault block in "
                    f"{path.as_posix()}:{index + 1}: {exc}"
                ),
            ) from exc
        try:
            rotated = new_vault.encrypt(plaintext.encode("utf-8")).decode(
                "utf-8", errors="replace"
            )
        except Exception as exc:
            raise HTTPException(
                status_code=500,
                detail=(
                    f"failed to encrypt vault block in "
                    f"{path.as_posix()}:{index + 1}: {exc}"
                ),
            ) from exc

        output.append(line)
        for encrypted_line in rotated.strip().splitlines():
            output.append((" " * block_indent) + encrypted_line)
        replaced_blocks += 1
        index = cursor

    updated = "\n".join(output)
    if had_trailing_newline:
        updated += "\n"
    return updated, replaced_blocks
