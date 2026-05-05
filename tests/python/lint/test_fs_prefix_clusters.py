"""Filesystem-layout lint: refuse prefix-cluster directories.

When a directory accumulates many files sharing a common first
"word" (e.g. `workspaces_*.py`, `workspace_*.py`, `Deployment*.tsx`),
finding the right file becomes a chore. This test detects such
clusters and asks for a subdirectory.

Two layers of coverage:

1. Rule unit tests pin down `first_word` semantics
   (snake_case / kebab-case / CamelCase) and the cluster detector
   itself, using synthetic temp dirs.

2. The repo integration test runs the same rule against three
   directories that, today, are full of clusters and should be
   broken into subdirectories:

       apps/api/api/routes/         (workspaces_*.py)
       apps/api/services/workspaces/ (workspace_*.py)
       apps/web/app/components/     (Deployment*.tsx)

   It is **expected to fail** until those clusters are
   reorganised. The pre-commit hook runs only `make lint` +
   `make test-unit`, so this test won't block commits — but
   `make test` (and `make test-lint`) calls into it.
"""

from __future__ import annotations

import re
import unittest
from dataclasses import dataclass
from pathlib import Path
from tempfile import TemporaryDirectory

CLUSTER_THRESHOLD = 3
CHECKED_EXTENSIONS = (".py", ".ts", ".tsx", ".js", ".jsx", ".css")


def first_word(filename: str) -> str:
    """Extract the first word of a file name, ignoring extension.

    Rules:
    - Strip a single trailing ``.<ext>`` (no special-casing of
      ``.module.css`` etc. — the leading word is what matters).
    - If the stem contains ``_``, the word ends at the first ``_``.
    - Else if it contains ``-``, the word ends at the first ``-``.
    - Else if it starts with an uppercase letter (CamelCase), the
      word ends at the next uppercase boundary.
    - Otherwise the entire stem is the word.
    """
    stem = filename.rsplit(".", 1)[0]
    if "_" in stem:
        return stem.split("_", 1)[0]
    if "-" in stem:
        return stem.split("-", 1)[0]
    match = re.match(r"^([A-Z][a-z0-9]*)(?=[A-Z]|$)", stem)
    if match:
        return match.group(1)
    return stem


@dataclass(frozen=True)
class Cluster:
    directory: Path
    prefix: str
    files: tuple[str, ...]


def find_clusters(
    directory: Path,
    *,
    threshold: int = CLUSTER_THRESHOLD,
    extensions: tuple[str, ...] = CHECKED_EXTENSIONS,
) -> list[Cluster]:
    """Return every prefix-cluster in ``directory`` (non-recursive)."""
    if not directory.is_dir():
        return []
    by_prefix: dict[str, list[str]] = {}
    for child in sorted(directory.iterdir()):
        if not child.is_file():
            continue
        if not any(child.name.endswith(ext) for ext in extensions):
            continue
        prefix = first_word(child.name)
        by_prefix.setdefault(prefix, []).append(child.name)
    clusters: list[Cluster] = []
    for prefix, files in by_prefix.items():
        if len(files) >= threshold:
            clusters.append(
                Cluster(directory=directory, prefix=prefix, files=tuple(files))
            )
    return clusters


_RECURSE_SKIP_DIRS = {
    "__pycache__",
    "node_modules",
    ".next",
    ".venv",
    "venv",
    ".git",
    "dist",
    "build",
}


def find_clusters_recursive(
    root: Path,
    *,
    threshold: int = CLUSTER_THRESHOLD,
    extensions: tuple[str, ...] = CHECKED_EXTENSIONS,
) -> list[Cluster]:
    """Walk ``root`` and run the cluster check on every directory.

    Subdirectories are NOT a free pass: if a freshly-created subfolder
    still hosts files that share a first-word prefix (e.g. moving
    ``WorkspacePanel.*`` under ``workspace/`` without renaming), the
    same UX problem recurs. Recursion catches that.
    """
    if not root.is_dir():
        return []
    out: list[Cluster] = []
    stack = [root]
    while stack:
        current = stack.pop()
        out.extend(find_clusters(current, threshold=threshold, extensions=extensions))
        for child in current.iterdir():
            if not child.is_dir() or child.is_symlink():
                continue
            if child.name in _RECURSE_SKIP_DIRS:
                continue
            stack.append(child)
    return out


def _format_cluster(cluster: Cluster, repo_root: Path) -> str:
    rel = cluster.directory.relative_to(repo_root)
    target_subdir = cluster.prefix.lower()
    files_block = "\n    - ".join(cluster.files)
    return (
        f"{rel}/: {len(cluster.files)} files share prefix "
        f"'{cluster.prefix}':\n    - {files_block}\n"
        f"  -> move them into {rel}/{target_subdir}/ "
        f"(or rename for distinctness) to keep the directory tidy."
    )


# ---------------------------------------------------------------- rule


class TestFirstWord(unittest.TestCase):
    def test_snake_case(self) -> None:
        self.assertEqual(first_word("workspace_service.py"), "workspace")
        self.assertEqual(first_word("workspaces_management_routes.py"), "workspaces")

    def test_kebab_case(self) -> None:
        self.assertEqual(first_word("my-component.tsx"), "my")

    def test_camel_case(self) -> None:
        self.assertEqual(first_word("DeploymentWorkspace.tsx"), "Deployment")
        self.assertEqual(first_word("DeploymentCredentialsForm.tsx"), "Deployment")

    def test_camel_case_single_word(self) -> None:
        self.assertEqual(first_word("Workspace.tsx"), "Workspace")

    def test_lowercase_single_word(self) -> None:
        self.assertEqual(first_word("helpers.ts"), "helpers")

    def test_double_extension_kept_in_first_word(self) -> None:
        # We only strip ONE extension. `foo.module.css` -> stem `foo.module`,
        # first word is still `foo` (no underscore/dash/Camel boundary in
        # `foo` itself, so the whole stem before the next `.` is the word).
        # This matters because the bare stem keeps clustering correct.
        self.assertEqual(first_word("foo.module.css"), "foo.module")


class TestFindClusters(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.root = Path(self._tmp.name)

    def _touch(self, *names: str) -> None:
        for name in names:
            (self.root / name).write_text("", encoding="utf-8")

    def test_no_cluster_below_threshold(self) -> None:
        self._touch("foo_a.py", "foo_b.py")
        self.assertEqual(find_clusters(self.root, threshold=3), [])

    def test_snake_case_cluster_at_threshold(self) -> None:
        self._touch("foo_a.py", "foo_b.py", "foo_c.py")
        clusters = find_clusters(self.root, threshold=3)
        self.assertEqual(len(clusters), 1)
        self.assertEqual(clusters[0].prefix, "foo")
        self.assertEqual(set(clusters[0].files), {"foo_a.py", "foo_b.py", "foo_c.py"})

    def test_camel_case_cluster(self) -> None:
        self._touch(
            "DeploymentA.tsx", "DeploymentB.tsx", "DeploymentC.tsx", "Other.tsx"
        )
        clusters = find_clusters(self.root, threshold=3)
        self.assertEqual(len(clusters), 1)
        self.assertEqual(clusters[0].prefix, "Deployment")

    def test_subdirectories_are_ignored(self) -> None:
        # A subfolder is the *cure* — the rule must not recurse into
        # it and re-flag the same cluster from inside.
        sub = self.root / "workspaces"
        sub.mkdir()
        for name in ("a.py", "b.py", "c.py"):
            (sub / name).write_text("", encoding="utf-8")
        self.assertEqual(find_clusters(self.root, threshold=3), [])

    def test_extension_filter(self) -> None:
        self._touch("foo_a.py", "foo_b.py", "foo_c.txt")
        # Only 2 .py files now -> below threshold.
        self.assertEqual(find_clusters(self.root, threshold=3), [])

    def test_underscore_only_one_segment(self) -> None:
        # Files named exactly `<word>.py` (no underscore) still
        # contribute to the `<word>` cluster because
        # `first_word("foo.py")` is `foo`.
        self._touch("foo.py", "foo_bar.py", "foo_baz.py")
        clusters = find_clusters(self.root, threshold=3)
        self.assertEqual(len(clusters), 1)
        self.assertEqual(clusters[0].prefix, "foo")


# --------------------------------------------------------- repo integration

REPO_ROOT = Path(__file__).resolve().parents[3]

CHECKED_DIRECTORIES = (
    REPO_ROOT / "apps" / "api" / "api" / "routes",
    REPO_ROOT / "apps" / "api" / "services" / "workspaces",
    REPO_ROOT / "apps" / "web" / "app" / "components",
)


class TestRepoHasNoPrefixClusters(unittest.TestCase):
    """Apply the rule to the actual repo. Expected to fail until the
    flagged clusters are reorganised into subdirectories."""

    def test_no_prefix_clusters_in_checked_dirs(self) -> None:
        # Recurse into subdirectories: simply moving files into a
        # subfolder without renaming (e.g. workspace/WorkspacePanel*)
        # still hosts the same UX problem and must be flagged.
        all_clusters: list[Cluster] = []
        for directory in CHECKED_DIRECTORIES:
            all_clusters.extend(find_clusters_recursive(directory))
        if not all_clusters:
            return
        report_lines = [
            "Files in the same directory share a first-word prefix.",
            "Move them into a subdirectory (or rename) to keep navigation manageable.",
            "",
        ]
        for cluster in all_clusters:
            report_lines.append(_format_cluster(cluster, REPO_ROOT))
            report_lines.append("")
        self.fail("\n".join(report_lines))


if __name__ == "__main__":
    unittest.main()
