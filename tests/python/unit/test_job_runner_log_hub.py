import unittest
from unittest.mock import patch

from services.job_runner.log_hub import LogHub


class TestLogHub(unittest.TestCase):
    def test_unsubscribe_releases_memory_only_after_last_subscriber(self) -> None:
        hub = LogHub()
        q_one, _ = hub.subscribe("job-1", replay_buffer=False)
        q_two, _ = hub.subscribe("job-1", replay_buffer=False)

        with (
            patch(
                "services.job_runner.log_hub._release_process_memory"
            ) as release_memory,
            patch(
                "services.job_runner.log_hub._schedule_delayed_process_memory_release"
            ) as schedule_release,
        ):
            hub.unsubscribe("job-1", q_one)
            release_memory.assert_not_called()
            schedule_release.assert_not_called()

            hub.unsubscribe("job-1", q_two)
            release_memory.assert_called_once_with()
            schedule_release.assert_called_once_with()
