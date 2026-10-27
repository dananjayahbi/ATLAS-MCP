"""Task routes: list, create, detail, priority, DoD, queue ops (Doc 04 §5.2–5.5)."""

from __future__ import annotations

from django.db.models import Count, Prefetch, Q
from rest_framework.response import Response

from api.common.pagination import decode_cursor, encode_cursor, resolve_page_size
from api.v1.serializers.task import serialize_task_detail, serialize_task_summary
from api.v1.views.base import (
    AtlasAPIView,
    body,
    optional_int,
    optional_str,
    require_field,
)
from core import leases
from core.errors import ValidationError
from core.models import ChecklistItem, Project, Task, TaskEvent
from core.services import tasks as task_service


class TaskListView(AtlasAPIView):
    def get(self, request, slug: str):
        project = task_service.get_project(slug)
        page_size = resolve_page_size(request.query_params.get("limit"))
        status_filter = request.query_params.get("status")
        cursor = decode_cursor(request.query_params.get("cursor"))

        qs = (
            Task.objects.filter(project=project)
            .select_related("project")
            .annotate(
                _dod_total=Count("checklist", distinct=True),
                _dod_done=Count(
                    "checklist", filter=Q(checklist__completed=True), distinct=True
                ),
                _blocker_count=Count("blocked_by", distinct=True),
                _child_count=Count("children", distinct=True),
            )
        )
        if status_filter:
            qs = qs.filter(status=status_filter)

        if cursor:
            from django.db.models import Q as DQ

            created_at, obj_id = cursor
            qs = qs.filter(
                DQ(created_at__gt=created_at)
                | (DQ(created_at=created_at) & DQ(pk__gt=obj_id))
            )
        qs = qs.order_by("-priority", "created_at", "pk")

        rows = list(qs[: page_size + 1])
        has_more = len(rows) > page_size
        rows = rows[:page_size]
        next_cursor = (
            encode_cursor(rows[-1].created_at, rows[-1].pk) if has_more and rows else None
        )
        return Response(
            {
                "items": [serialize_task_summary(t) for t in rows],
                "next_cursor": next_cursor,
            }
        )

    def post(self, request, slug: str):
        payload = body(request)
        task = task_service.create_task(
            project_slug=slug,
            title=require_field(payload, "title"),
            description=require_field(payload, "description"),
            priority=optional_int(payload, "priority", 50) or 50,
            dod_items=payload.get("definition_of_done") or payload.get("dod_items"),
            blocked_by_ids=payload.get("blocked_by") or [],
            parent_task_id=payload.get("parent_task_id"),
        )
        return Response(_detail(task), status=201)


class TaskDetailView(AtlasAPIView):
    def get(self, request, task_id: str):
        task = _load_detail(task_id)
        return Response(_detail(task))

    def patch(self, request, task_id: str):
        payload = body(request)
        task = task_service.get_task(task_id)
        if "priority" in payload:
            priority = optional_int(payload, "priority")
            if priority is None:
                raise ValidationError("priority is required.", detail={"field": "priority"})
            task = task_service.set_priority(task_id=task.pk, priority=priority)
        return Response(_detail(_load_detail(task.pk)))


class TaskPriorityView(AtlasAPIView):
    def patch(self, request, task_id: str):
        payload = body(request)
        priority = require_field(payload, "priority")
        if isinstance(priority, bool) or not isinstance(priority, int):
            raise ValidationError("priority must be an integer.",
                                  detail={"field": "priority"})
        task = task_service.set_priority(task_id=task_id, priority=priority)
        return Response(serialize_task_summary(task))


class TaskDodView(AtlasAPIView):
    def patch(self, request, task_id: str, item_id: int):
        payload = body(request)
        completed = payload.get("completed")
        if not isinstance(completed, bool):
            raise ValidationError("completed must be a boolean.",
                                  detail={"field": "completed"})
        task, percent = task_service.update_dod_item(
            task_id=task_id, item_id=int(item_id), completed=completed,
            agent_identifier="human",
        )
        return Response({"ok": True, "dod_progress_percent": percent})


class TaskForceReleaseView(AtlasAPIView):
    def post(self, request, task_id: str):
        payload = body(request)
        task = leases.release(
            task_id=task_id,
            actor=optional_str(payload, "actor", "human"),
            reason="force_release",
        )
        return Response(_summary(task))


class TaskArchiveView(AtlasAPIView):
    def post(self, request, task_id: str):
        body(request)
        task = task_service.archive_task(task_id=task_id)
        return Response(_summary(task))


class TaskRequeueView(AtlasAPIView):
    def post(self, request, task_id: str):
        body(request)
        task = task_service.requeue_task(task_id=task_id)
        return Response(_summary(task))


class TaskClaimForAgentView(AtlasAPIView):
    """T14 — the only route that emits `TASK_ALREADY_LEASED` (Doc 01 §8)."""

    def post(self, request, task_id: str):
        from core.leases import claim_specific_task

        payload = body(request)
        agent = require_field(payload, "agent_identifier")
        result = claim_specific_task(task_id=task_id, agent_identifier=agent)
        return Response(
            {
                "task_id": str(result.task.pk),
                "status": result.task.status,
                "lease_id": result.lease_id,
                "agent_identifier": agent,
            }
        )


class TaskHistoryView(AtlasAPIView):
    def get(self, request, task_id: str):
        task = task_service.get_task(task_id)
        from api.v1.serializers.event import serialize_event

        limit = resolve_page_size(request.query_params.get("limit"))
        rows = list(task.events.order_by("-seq")[:limit])
        return Response(
            {"items": [serialize_event(e) for e in reversed(rows)], "next_cursor": None}
        )


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------
def _load_detail(task_id) -> Task:
    from django.shortcuts import get_object_or_404

    from core.errors import TaskNotFound

    try:
        return (
            Task.objects.select_related("project")
            .prefetch_related(
                Prefetch("checklist", queryset=ChecklistItem.objects.order_by("order_index")),
                "assets",
                "blocked_by",
                "blocks",
                "children",
            )
            .get(pk=task_id)
        )
    except (Task.DoesNotExist, ValueError, TypeError):
        raise TaskNotFound("Task not found.", detail={"task_id": str(task_id)}) from None


def _detail(task: Task) -> dict:
    from api.v1.serializers.event import serialize_event

    events = [
        serialize_event(e) for e in reversed(list(task.events.order_by("-seq")[:50]))
    ]
    return serialize_task_detail(task, events=events)


def _summary(task: Task) -> dict:
    return serialize_task_summary(task)
