from __future__ import annotations

import unittest

from tests.python.integration.perf_sse_scalability_support import (
    post_memory_ceiling_mib,
)


class TestPerfSseScalabilitySupport(unittest.TestCase):
    def test_post_memory_ceiling_uses_absolute_headroom_for_small_baseline(
        self,
    ) -> None:
        self.assertEqual(post_memory_ceiling_mib(50.0), 66.0)

    def test_post_memory_ceiling_uses_ratio_for_larger_baseline(self) -> None:
        self.assertEqual(post_memory_ceiling_mib(200.0), 240.0)
