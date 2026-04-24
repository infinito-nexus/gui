from __future__ import annotations

import time
import unittest

import httpx

from .perf_support import (
    api_base_url,
    compose_ps_quiet,
    docker_exec,
    roles_catalog_host_path,
    timing_summary,
    wait_for_http_ready,
    write_perf_result,
)


ROLE_LIST_P95_TARGET_MS = 200.0
ROLE_DETAIL_P95_TARGET_MS = 100.0
ROLE_MAX_TARGET_MS = 1000.0
WARMUP_REQUESTS = 5
MEASURED_REQUESTS = 200
POST_INVALIDATION_WARM_SAMPLES = 20


class TestPerfRoleIndex(unittest.TestCase):
    def test_role_index_warm_cache_targets(self) -> None:
        base_url = api_base_url()
        wait_for_http_ready(f"{base_url}/health")

        samples: list[dict[str, float | str]] = []
        thresholds: dict[str, dict[str, float | str]] = {}
        failure_messages: list[str] = []

        with httpx.Client(base_url=base_url, timeout=10.0) as client:
            for _ in range(WARMUP_REQUESTS):
                response = client.get("/api/roles")
                response.raise_for_status()

            role_list_samples = self._measure_endpoint(
                client,
                "/api/roles",
                sample_name="GET /api/roles",
                samples=samples,
            )
            roles_response = client.get("/api/roles")
            roles_response.raise_for_status()
            role_ids = [
                str(entry.get("id") or "").strip() for entry in roles_response.json()
            ]
            role_ids = [role_id for role_id in role_ids if role_id]
            self.assertTrue(
                role_ids, "role index must not be empty for perf measurement"
            )

            for _ in range(WARMUP_REQUESTS):
                role_id = role_ids[_ % len(role_ids)]
                response = client.get(f"/api/roles/{role_id}")
                response.raise_for_status()

            role_detail_samples = []
            for idx in range(MEASURED_REQUESTS):
                role_id = role_ids[idx % len(role_ids)]
                started_at = time.perf_counter()
                response = client.get(f"/api/roles/{role_id}")
                elapsed_ms = (time.perf_counter() - started_at) * 1000
                response.raise_for_status()
                role_detail_samples.append(elapsed_ms)
                samples.append(
                    {
                        "name": "GET /api/roles/{role_id}",
                        "value_ms": round(elapsed_ms, 3),
                        "timestamp": time.time(),
                    }
                )

            catalog_path = roles_catalog_host_path()
            self.assertTrue(
                catalog_path.is_file(), f"missing role catalog at {catalog_path}"
            )
            self._touch_catalog_via_container()
            started_at = time.perf_counter()
            invalidated_response = client.get("/api/roles")
            invalidation_first_ms = (time.perf_counter() - started_at) * 1000
            invalidated_response.raise_for_status()
            samples.append(
                {
                    "name": "GET /api/roles after invalidation",
                    "value_ms": round(invalidation_first_ms, 3),
                    "timestamp": time.time(),
                }
            )

            for _ in range(WARMUP_REQUESTS):
                response = client.get("/api/roles")
                response.raise_for_status()

            post_invalidation_samples = []
            for _ in range(POST_INVALIDATION_WARM_SAMPLES):
                started_at = time.perf_counter()
                response = client.get("/api/roles")
                elapsed_ms = (time.perf_counter() - started_at) * 1000
                response.raise_for_status()
                post_invalidation_samples.append(elapsed_ms)
                samples.append(
                    {
                        "name": "GET /api/roles post-invalidation warm",
                        "value_ms": round(elapsed_ms, 3),
                        "timestamp": time.time(),
                    }
                )

        role_list_summary = timing_summary(role_list_samples)
        role_detail_summary = timing_summary(role_detail_samples)
        post_invalidation_summary = timing_summary(post_invalidation_samples)
        overall_max = max(role_list_summary["max"], role_detail_summary["max"])

        thresholds["roles_list_p95"] = {
            "target": ROLE_LIST_P95_TARGET_MS,
            "observed": role_list_summary["p95"],
            "context": {
                "endpoint": "/api/roles",
                "sample_count": len(role_list_samples),
            },
            "status": "pass"
            if float(role_list_summary["p95"]) < ROLE_LIST_P95_TARGET_MS
            else "fail",
        }
        thresholds["role_detail_p95"] = {
            "target": ROLE_DETAIL_P95_TARGET_MS,
            "observed": role_detail_summary["p95"],
            "context": {
                "endpoint": "/api/roles/{role_id}",
                "sample_count": len(role_detail_samples),
            },
            "status": "pass"
            if float(role_detail_summary["p95"]) < ROLE_DETAIL_P95_TARGET_MS
            else "fail",
        }
        thresholds["warm_max"] = {
            "target": ROLE_MAX_TARGET_MS,
            "observed": overall_max,
            "context": {
                "sample_count": len(role_list_samples) + len(role_detail_samples)
            },
            "status": "pass" if float(overall_max) <= ROLE_MAX_TARGET_MS else "fail",
        }
        thresholds["post_invalidation_p95"] = {
            "target": ROLE_LIST_P95_TARGET_MS,
            "observed": post_invalidation_summary["p95"],
            "context": {
                "endpoint": "/api/roles",
                "sample_count": len(post_invalidation_samples),
            },
            "status": "pass"
            if float(post_invalidation_summary["p95"]) < ROLE_LIST_P95_TARGET_MS
            else "fail",
        }

        for threshold_name, threshold in thresholds.items():
            if str(threshold["status"]) == "fail":
                context = threshold.get("context")
                failure_messages.append(
                    f"{threshold_name} violated: observed={threshold['observed']} target={threshold['target']} context={context}"
                )

        status = (
            "pass"
            if all(item["status"] == "pass" for item in thresholds.values())
            else "fail"
        )
        write_perf_result(
            "role-index",
            samples=samples,
            thresholds=thresholds,
            summary_values=role_list_samples
            + role_detail_samples
            + post_invalidation_samples,
            status=status,
            failure_messages=failure_messages,
        )

        self.assertLess(float(role_list_summary["p95"]), ROLE_LIST_P95_TARGET_MS)
        self.assertLess(float(role_detail_summary["p95"]), ROLE_DETAIL_P95_TARGET_MS)
        self.assertLessEqual(float(overall_max), ROLE_MAX_TARGET_MS)
        self.assertLess(
            float(post_invalidation_summary["p95"]), ROLE_LIST_P95_TARGET_MS
        )

    def _touch_catalog_via_container(self) -> None:
        catalog_container_id = compose_ps_quiet("catalog")
        self.assertTrue(catalog_container_id, "catalog container must be running")
        docker_exec(
            catalog_container_id,
            "sh",
            "-lc",
            'touch "${STATE_DIR}/catalog/roles/list.json"',
        )

    def _measure_endpoint(
        self,
        client: httpx.Client,
        path: str,
        *,
        sample_name: str,
        samples: list[dict[str, float | str]],
    ) -> list[float]:
        durations: list[float] = []
        for _ in range(MEASURED_REQUESTS):
            started_at = time.perf_counter()
            response = client.get(path)
            elapsed_ms = (time.perf_counter() - started_at) * 1000
            response.raise_for_status()
            durations.append(elapsed_ms)
            samples.append(
                {
                    "name": sample_name,
                    "value_ms": round(elapsed_ms, 3),
                    "timestamp": time.time(),
                }
            )
        return durations
