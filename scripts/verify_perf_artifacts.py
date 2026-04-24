from __future__ import annotations

import json
from pathlib import Path


def main() -> None:
    root = Path("state/perf/016")
    files = sorted(root.glob("*.json"))
    assert files, "no perf result artifacts were produced"

    failed: list[str] = []
    for path in files:
        payload = json.loads(path.read_text(encoding="utf-8"))
        if payload.get("status") == "pass":
            continue
        failed.append(path.name)
        print(f"✖ {path.name} failed")
        for message in payload.get("failure_messages") or []:
            print(f"  - {message}")
        for threshold_name, threshold in (payload.get("thresholds") or {}).items():
            if threshold.get("status") != "fail":
                continue
            print(
                "  - threshold"
                f" {threshold_name}: observed={threshold.get('observed')}"
                f" target={threshold.get('target')}"
                f" context={threshold.get('context')}"
            )

    assert not failed, "perf thresholds failed: " + ", ".join(failed)


if __name__ == "__main__":
    main()
