"""SSE transport: two routes, one project channel + one task channel (Doc 09 §2).

Frames use the frozen §7.9 envelope, `seq` for `Last-Event-ID` replay, and a
`stream.reset` control frame when the process boot id changed.
"""

from __future__ import annotations

import json
import logging
import queue
import time

from django.conf import settings
from django.http import StreamingHttpResponse
from django.views.decorators.http import require_GET

from api.common.auth import require_token
from core.enums import EventType
from core.errors import AtlasError, TaskNotFound
from core.events import Envelope, bus, last_seq, replay, reset_frame
from core.models import Project, Task

logger = logging.getLogger("atlas.sse")

KEEPALIVE_SECONDS = int(getattr(settings, "ATLAS_SSE_KEEPALIVE_SECONDS", 15))
#: Comments/heartbeat budget per connection before the client must reconnect.
MAX_FRAMES = 10_000


def _sse_headers() -> dict[str, str]:
    """Headers required for unbuffered streaming (Doc 09 §5.9).

    `Connection: keep-alive` is deliberately absent: it is a hop-by-hop header
    and Django's WSGI handler raises `AssertionError` if a view sets it. HTTP/1.1
    is persistent by default, so the header is redundant anyway.
    """
    return {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
        "Access-Control-Allow-Origin": getattr(settings, "ATLAS_WEB_ORIGIN", "*"),
    }


def _frame(envelope: Envelope) -> bytes:
    return envelope.to_sse().encode("utf-8")


def _comment(text: str) -> bytes:
    return f": {text}\n\n".encode("utf-8")


def _last_event_seq(request, project_id) -> int:
    """Resolve `Last-Event-ID` (a ULID) to a `seq`; fall back to 0."""
    token = request.headers.get("Last-Event-ID") or _param(request, "last_event_id")
    if not token:
        return 0
    from core.models import TaskEvent

    row = TaskEvent.objects.filter(project_id=project_id, id=token).only("seq").first()
    return row.seq if row else 0


def _param(request, name: str) -> str:
    """`query_params` exists only on DRF requests; SSE views are plain Django."""
    params = getattr(request, "query_params", None)
    if params is not None:
        return params.get(name) or ""
    return request.GET.get(name) or ""


def _stream(request, *, project: Project, task_id=None, replay_only=False):
    """Generator shared by both routes."""
    after = _last_event_seq(request, project.pk)
    q = bus.subscribe(project.slug)
    deadline = time.monotonic() + 60 * 60  # hard cap; EventSource reconnects
    frames = 0

    try:
        # 1. Resume: replay everything the client missed.
        for envelope in replay(project.pk, after_seq=after, limit=500):
            if task_id and envelope.task_id != str(task_id):
                continue
            yield _frame(envelope)
            frames += 1

        # 2. Reset signal so the client can drop stale local state.
        if after == 0:
            yield _frame(reset_frame(project.slug))

        if replay_only:
            yield _comment("replay complete")
            return

        # 3. Live fan-out with keepalive.
        last_write = time.monotonic()
        while time.monotonic() < deadline and frames < MAX_FRAMES:
            try:
                envelope = q.get(timeout=1.0)
            except queue.Empty:
                if time.monotonic() - last_write >= KEEPALIVE_SECONDS:
                    yield _comment("ping")
                    last_write = time.monotonic()
                continue
            if task_id and envelope.task_id != str(task_id):
                continue
            # R1: the project channel never carries raw task.log frames.
            if task_id is None and envelope.type == EventType.TASK_LOG:
                continue
            yield _frame(envelope)
            last_write = time.monotonic()
            frames += 1
    except GeneratorExit:  # client disconnected
        return
    finally:
        bus.unsubscribe(project.slug, q)


@require_GET
def events_stream(request):
    """`GET /api/v1/stream/events?project_slug=` — project channel."""
    try:
        require_token(request)
    except AtlasError as exc:
        from django.http import JsonResponse

        return JsonResponse(exc.to_envelope(getattr(request, "request_id", None)),
                            status=exc.http_status)

    slug = _param(request, "project_slug")
    project = Project.objects.filter(slug=slug).only("id", "slug").first()
    if project is None:
        from django.http import JsonResponse

        from core.errors import ProjectNotFound

        err = ProjectNotFound(f"No project with slug '{slug}'.", detail={"slug": slug})
        return JsonResponse(err.to_envelope(), status=err.http_status)

    response = StreamingHttpResponse(
        _stream(request, project=project), content_type="text/event-stream"
    )
    for key, value in _sse_headers().items():
        response[key] = value
    return response


@require_GET
def task_log_stream(request, task_id):
    """`GET /api/v1/stream/tasks/{id}/log` — task channel."""
    try:
        require_token(request)
    except AtlasError as exc:
        from django.http import JsonResponse

        return JsonResponse(exc.to_envelope(getattr(request, "request_id", None)),
                            status=exc.http_status)

    try:
        task = Task.objects.select_related("project").only(
            "id", "project_id", "project__slug"
        ).get(pk=task_id)
    except Task.DoesNotExist:
        err = TaskNotFound("Task not found.", detail={"task_id": str(task_id)})
        from django.http import JsonResponse

        return JsonResponse(err.to_envelope(), status=err.http_status)

    response = StreamingHttpResponse(
        _stream(request, project=task.project, task_id=task.pk),
        content_type="text/event-stream",
    )
    for key, value in _sse_headers().items():
        response[key] = value
    return response


def snapshot_payload(project_slug: str) -> str:
    """Debug helper: the frames a fresh client would receive immediately."""
    project = Project.objects.filter(slug=project_slug).only("id").first()
    if project is None:
        return json.dumps({"error": "PROJECT_NOT_FOUND"})
    return json.dumps([e.to_dto() for e in replay(project.pk, limit=50)])
