"""SSE transport tests (Doc 09 §2).

Regression guard for a bug that shipped silently: a *synchronous* stream
generator makes Django materialise the whole response via
`sync_to_async(list)`, so a client received headers and then nothing until the
generator finished. These tests assert the response really is an async iterator
and that frames are produced incrementally.
"""

from __future__ import annotations

import asyncio
import inspect
import queue

import pytest
from django.test import Client

from api import sse, sse_stream

pytestmark = pytest.mark.django_db

TOKEN = "test-token"
AUTH = {"HTTP_AUTHORIZATION": f"Bearer {TOKEN}"}


@pytest.fixture
def client():
    return Client()


def _stream(client, path, params):
    return client.get(path, params, **AUTH)


def test_stream_generator_is_async():
    """The generator handed to StreamingHttpResponse must be async."""
    assert inspect.isasyncgenfunction(sse._stream_async), (
        "SSE must be an async generator; a sync one is buffered until completion "
        "under ASGI and streams nothing"
    )


def test_project_stream_uses_the_async_generator(client, project):
    response = _stream(client, "/api/v1/stream/events", {"project_slug": project.slug})
    try:
        assert response.status_code == 200
        assert response["Content-Type"].startswith("text/event-stream")
        assert inspect.isasyncgen(response.streaming_content), (
            "Django buffers synchronous iterators; the body must be an async iterator"
        )
    finally:
        response.close()


def test_task_stream_uses_the_async_generator(client, task):
    response = _stream(client, f"/api/v1/stream/tasks/{task.pk}/log", {})
    try:
        assert response.status_code == 200
        assert inspect.isasyncgen(response.streaming_content)
    finally:
        response.close()


def test_hop_by_hop_connection_header_is_absent(client, project):
    """`Connection` is hop-by-hop; setting it makes the WSGI handler assert."""
    response = _stream(client, "/api/v1/stream/events", {"project_slug": project.slug})
    try:
        assert "Connection" not in response
    finally:
        response.close()


def test_stream_requires_a_token(client, project):
    response = client.get("/api/v1/stream/events", {"project_slug": project.slug})
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_drain_queue_yields_frames_incrementally():
    """A queued frame must surface without waiting for the stream to end."""
    q: queue.Queue = queue.Queue()
    q.put_nowait("first")
    q.put_nowait("second")

    seen = []
    agen = sse_stream.drain_queue(q, max_seconds=5, max_frames=2)
    async for kind, payload in agen:
        seen.append((kind, payload))
    await agen.aclose()

    assert seen == [("frame", "first"), ("frame", "second")]


@pytest.mark.asyncio
async def test_drain_queue_emits_keepalive_when_idle():
    """An idle stream must still produce a keepalive rather than blocking."""
    q: queue.Queue = queue.Queue()
    agen = sse_stream.drain_queue(q, keepalive_seconds=0, max_seconds=5)
    kind, payload = await asyncio.wait_for(agen.__anext__(), timeout=3)
    await agen.aclose()

    assert (kind, payload) == ("keepalive", None)


def test_project_channel_hides_raw_task_logs():
    """R1: raw `task.log` frames belong to the task channel only."""

    class Envelope:
        type = "task.log"
        task_id = "abc"

    assert sse_stream.is_visible(envelope=Envelope(), task_id=None) is False
    assert sse_stream.is_visible(envelope=Envelope(), task_id="abc") is True
    assert sse_stream.is_visible(envelope=Envelope(), task_id="other") is False
