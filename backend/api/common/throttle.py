"""Simple in-process throttle for upload-heavy routes (Doc 04 §3.4)."""

from __future__ import annotations

import threading
import time
from collections import defaultdict, deque

from core.errors import AtlasError

_WINDOW_SECONDS = 60.0
_LIMITS = {"assets": 60, "discoveries": 30, "default": 240}


class SlidingWindowThrottle:
    """Per-token, per-route-family sliding window.

    Deliberately in-process: the deployment target is a single loopback ASGI
    worker, so a shared cache would add a dependency without buying anything.
    """

    def __init__(self, family: str = "default") -> None:
        self.family = family
        self.limit = _LIMITS.get(family, _LIMITS["default"])
        self._lock = threading.Lock()
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def check(self, key: str) -> None:
        now = time.monotonic()
        cutoff = now - _WINDOW_SECONDS
        with self._lock:
            bucket = self._hits[key]
            while bucket and bucket[0] < cutoff:
                bucket.popleft()
            if len(bucket) >= self.limit:
                raise AtlasError(
                    "Too many requests; retry shortly.",
                    code="RATE_LIMITED",
                    retryable=True,
                    detail={"limit": self.limit, "window_seconds": _WINDOW_SECONDS},
                )
            bucket.append(now)


throttles = {
    "assets": SlidingWindowThrottle("assets"),
    "discoveries": SlidingWindowThrottle("discoveries"),
    "default": SlidingWindowThrottle("default"),
}
