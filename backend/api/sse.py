"""SSE transport: two routes, one project channel + one task channel (Doc 09 §2).

Frames use the frozen §7.9 envelope, `seq` for `Last-Event-ID` replay, and a
`stream.reset` control frame when the process boot id changed.
"""

from __future__ import annotations

import asyncio

from django.conf import settings
from django.http import StreamingHttpResponse
from django.views.decorators.http import require_GET

from api.common.auth import require_token
from api.sse_stream import drain_queue, is_visible
from core.errors import AtlasError, TaskNotFound
from core.events import Envelope, bus, replay, reset_frame
from core.models import Project, Task


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


def _initial_frames(request, project, task_id):
    """Resume payload, computed off the event loop.

    Django forbids ORM access from an async context (`SynchronousOnlyOperation`),
    so `_stream_async` calls this via `asyncio.to_thread`.
    """
    after = _last_event_seq(request, project.pk)
    frames = [
        _frame(envelope)
        for envelope in replay(project.pk, after_seq=after, limit=500)
        if is_visible(envelope=envelope, task_id=task_id)
    ]
    if after == 0:
        frames.append(_frame(reset_frame(project.slug)))
    return after, frames


async def _stream_async(request, *, project: Project, task_id=None, replay_only=False):
    """Async generator shared by both routes.

    Must be `async def` — see the module docstring of `api.sse_stream`.
    """
    after, frames = await asyncio.to_thread(_initial_frames, request, project, task_id)
    q = bus.subscribe(project.slug)

    try:
        # 1. Resume: replay everything the client missed (+ reset when fresh).
        for frame in frames:
            yield frame

        if replay_only:
            yield _comment("replay complete")
            return

        # 2. Live fan-out with keepalive.
        async for kind, envelope in drain_queue(q):
            if kind == "keepalive":
                yield _comment("ping")
                continue
            if not is_visible(envelope=envelope, task_id=task_id):
                continue
            yield _frame(envelope)
    except (GeneratorExit, asyncio.CancelledError):  # client disconnected
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
        _stream_async(request, project=project), content_type="text/event-stream"
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
        _stream_async(request, project=task.project, task_id=task.pk),
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
