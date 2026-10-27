"""Route-family throttling (Doc 04 §3.4).

Rates are the frozen table from Doc 04:

| Scope    | Rate    | Applies to                                            |
| :------- | :------ | :---------------------------------------------------- |
| internal | 120/min | claim/heartbeat/progress/submit/propose (`/internal`)  |
| upload   |  20/min | `/assets/`                                            |
| read     | 600/min | `/api/v1` GETs                                        |

A rejection is `RATE_LIMITED` → **429** with a `Retry-After` header, which is
what Doc 06 §11.4 requires for the client's single-shot retry. Emitting 500
instead would make an ordinary burst look like a backend fault and would also
trip the HUD's `INTERNAL_ERROR` "retry once" path.

Deliberately in-process: the deployment target is a single loopback ASGI
worker, so a shared cache would add a dependency without buying anything.
"""

from __future__ import annotations

import threading
import time
from collections import defaultdict, deque

from core.errors import RateLimited

_WINDOW_SECONDS = 60.0

#: Doc 04 §3.4. Keys are throttle *families* declared by the view base classes.
_LIMITS = {"internal": 120, "upload": 20, "read": 600}


class SlidingWindowThrottle:
    """Per-key sliding window over a fixed budget."""

    def __init__(self, family: str, limit: int) -> None:
        self.family = family
        self.limit = limit
        self._lock = threading.Lock()
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def check(self, key: str) -> None:
        """Record one hit, or raise `RateLimited` when the window is full."""
        now = time.monotonic()
        cutoff = now - _WINDOW_SECONDS
        with self._lock:
            bucket = self._hits[key]
            while bucket and bucket[0] < cutoff:
                bucket.popleft()
            if len(bucket) >= self.limit:
                retry_after = max(1, int(_WINDOW_SECONDS - (now - bucket[0])) + 1)
                raise RateLimited(
                    detail={
                        "limit": self.limit,
                        "window_seconds": _WINDOW_SECONDS,
                        "retry_after_seconds": retry_after,
                    },
                    headers={"Retry-After": str(retry_after)},
                )
            bucket.append(now)

    def reset(self) -> None:
        """Clear every bucket. Tests only."""
        with self._lock:
            self._hits.clear()


throttles = {
    family: SlidingWindowThrottle(family, limit) for family, limit in _LIMITS.items()
}


def reset_all() -> None:
    """Clear every family. Tests only."""
    for throttle in throttles.values():
        throttle.reset()
