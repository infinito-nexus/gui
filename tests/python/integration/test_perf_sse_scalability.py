from __future__ import annotations

import asyncio
import unittest

from .perf_sse_scalability_api import PerfSseScalabilityApiMixin
from .perf_sse_scalability_stream import PerfSseScalabilityStreamMixin
from .perf_sse_scalability_support import PerfSseScalabilityScenarioMixin


class TestPerfSseScalability(
    PerfSseScalabilityApiMixin,
    PerfSseScalabilityStreamMixin,
    PerfSseScalabilityScenarioMixin,
    unittest.TestCase,
):
    def test_sse_scalability(self) -> None:
        result = asyncio.run(self._run_scenario())
        self.assertEqual(result["status"], "pass", result["failure_message"])
