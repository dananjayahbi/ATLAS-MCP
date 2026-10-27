"""Async SSE frame source.

Why this module exists
----------------------
`StreamingHttpResponse.__aiter__` falls back to a *synchronous* iterator via
`sync_to_async(list)(...)`, which **fully drains the generator** before the first
body byte is sent. Under ASGI that turned the event stream into a 1-hour hang:
headers arrived, then nothing. Django even warns about it:

    StreamingHttpResponse must consume synchronous iterators in order to serve
    them asynchronously. Use an asynchronous iterator instead.

So the stream is produced by an async generator that polls the (thread-safe)
`EventBus` queue with `asyncio.sleep` instead of `queue.get` — no event-loop
thread is blocked while the client waits, and every frame flushes immediately.

This module only knows about async plumbing; the frame/envelope rules stay in
`core.events` and the routing/auth rules stay in `api.sse`.
"""

from __future__ import annotations

import asyncio
import queue
import time
from typing import AsyncIterator

#: How long to wait for a subscriber queue item before yielding control back.
_POLL_TIMEOUT_SECONDS = 0.25
#: Keepalive comment budget, so a proxy does not drop an idle connection.
KEEPALIVE_SECONDS = 15
#: Hard cap; EventSource reconnects with Last-Event-ID.
STREAM_MAX_SECONDS = 60 * 60
#: Frames per connection before the client must reconnect.
MAX_FRAMES = 10_000


async def drain_queue(
    q: "queue.Queue",
    *,
    keepalive_seconds: int = KEEPALIVE_SECONDS,
    max_seconds: int = STREAM_MAX_SECONDS,
    max_frames: int = MAX_FRAMES,
) -> AsyncIterator[tuple[str, object]]:
    """Yield `("frame", envelope)` and `("keepalive", None)` events.

    `queue.Queue.get` blocks a thread, so it is polled with `get_nowait` and
    interleaved with `asyncio.sleep`, keeping the ASGI loop free to serve other
    connections (and to notice client disconnects).
    """
    deadline = time.monotonic() + max_seconds
    last_write = time.monotonic()
    frames = 0

    while time.monotonic() < deadline and frames < max_frames:
        try:
            envelope = q.get_nowait()
        except queue.Empty:
            if time.monotonic() - last_write >= keepalive_seconds:
                last_write = time.monotonic()
                yield ("keepalive", None)
            await asyncio.sleep(_POLL_TIMEOUT_SECONDS)
            continue

        last_write = time.monotonic()
        frames += 1
        yield ("frame", envelope)


def is_visible(*, envelope, task_id) -> bool:
    """Channel filtering shared by replay and live fan-out.

    - A task channel only carries that task's frames.
    - The project channel never carries raw `task.log` frames (R1).
    """
    from core.enums import EventType

    if task_id is not None:
        return str(envelope.task_id) == str(task_id)
    return envelope.type != EventType.TASK_LOG
