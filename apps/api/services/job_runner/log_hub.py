from __future__ import annotations

import ctypes
import gc
import queue
import threading
import time
from collections import deque
from typing import Deque, Dict, List, Tuple


def _release_process_memory() -> None:
    gc.collect()
    try:
        libc = ctypes.CDLL("libc.so.6")
    except OSError:
        return
    try:
        libc.malloc_trim(0)
    except Exception:
        return


def _schedule_delayed_process_memory_release(
    *, delays: tuple[float, ...] = (5.0, 30.0)
) -> None:
    def _worker() -> None:
        elapsed = 0.0
        for absolute_delay in delays:
            sleep_for = max(0.0, float(absolute_delay) - elapsed)
            if sleep_for:
                time.sleep(sleep_for)
            elapsed = float(absolute_delay)
            _release_process_memory()

    thread = threading.Thread(
        target=_worker,
        name="log-hub-memory-release",
        daemon=True,
    )
    thread.start()


class LogHub:
    def __init__(self, *, buffer_size: int = 200) -> None:
        self._lock = threading.Lock()
        self._buffers: Dict[str, Deque[str]] = {}
        self._subscribers: Dict[str, List[queue.Queue[str]]] = {}
        self._buffer_size = buffer_size

    def publish(self, job_id: str, line: str) -> None:
        with self._lock:
            buf = self._buffers.setdefault(job_id, deque(maxlen=self._buffer_size))
            buf.append(line)
            subscribers = list(self._subscribers.get(job_id, []))

        for q in subscribers:
            try:
                q.put_nowait(line)
            except queue.Full:
                # Drop line for slow consumers.
                continue

    def subscribe(
        self, job_id: str, *, replay_buffer: bool = True
    ) -> Tuple[queue.Queue[str], List[str]]:
        q: queue.Queue[str] = queue.Queue(maxsize=1000)
        with self._lock:
            self._subscribers.setdefault(job_id, []).append(q)
            buf = list(self._buffers.get(job_id, deque())) if replay_buffer else []
        return q, buf

    def unsubscribe(self, job_id: str, q: queue.Queue[str]) -> None:
        should_release_memory = False
        with self._lock:
            subs = self._subscribers.get(job_id)
            if not subs:
                return
            self._subscribers[job_id] = [s for s in subs if s is not q]
            if not self._subscribers[job_id]:
                self._subscribers.pop(job_id, None)
                should_release_memory = True

        if should_release_memory:
            _release_process_memory()
            _schedule_delayed_process_memory_release()
