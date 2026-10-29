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
        qs = _apply_filters(qs, request.query_params)
        sort_field, descending = _ordering(request.query_params)

        cursor = decode_cursor(request.query_params.get("cursor"))
        if cursor:
            value, obj_id, cursor_field = cursor
            # A cursor minted for another sort would resume at the wrong row.
            if cursor_field and cursor_field != sort_field:
                raise ValidationError(
                    "cursor does not match sort",
                    detail={"cursor_sort": cursor_field, "sort": sort_field},
                )
            lookup = f"{sort_field}__lt" if descending else f"{sort_field}__gt"
            pk_lookup = "pk__lt" if descending else "pk__gt"
            qs = qs.filter(
                Q(**{lookup: value})
                | (Q(**{sort_field: value}) & Q(**{pk_lookup: obj_id}))
            )

        prefix = "-" if descending else ""
        # `pk` breaks ties so the cursor resumes deterministically.
        qs = qs.order_by(f"{prefix}{sort_field}", f"{prefix}pk")

        rows = list(qs[: page_size + 1])
        has_more = len(rows) > page_size
        rows = rows[:page_size]
        next_cursor = (
            encode_cursor(getattr(rows[-1], sort_field), rows[-1].pk, sort_field)
            if has_more and rows
            else None
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
        editable = {"title", "description", "priority", "blocked_by", "dod_items"}
        unknown = sorted(set(payload) - editable)
        if unknown:
            raise ValidationError(
                f"Only {', '.join(sorted(editable))} can be patched here.",
                detail={"fields": unknown},
            )

        # Priority has its own transition (T-priority, `task.priority_changed`);
        # routing it through the generic updater would hide that event.
        if "priority" in payload:
            priority = optional_int(payload, "priority")
            if priority is None:
                raise ValidationError("priority is required.", detail={"field": "priority"})
            task_service.set_priority(task_id=task_id, priority=priority)

        dod_items = payload.get("dod_items")
        if dod_items is not None and not isinstance(dod_items, list):
            raise ValidationError("dod_items must be an array of strings.",
                                  detail={"field": "dod_items"})

        task = task_service.update_task(
            task_id=task_id,
            title=payload.get("title"),
            description=payload.get("description"),
            blocked_by_ids=payload.get("blocked_by"),
            dod_items=dod_items,
        )
        return Response(_detail(_load_detail(task.pk)))

    def delete(self, request, task_id: str):
        task_service.delete_task(task_id=task_id)
        return Response(status=204)


class TaskStatusView(AtlasAPIView):
    """Manual status override — Doc 01 §8 kept as the single guard table."""

    def patch(self, request, task_id: str):
        payload = body(request)
        task = task_service.set_status(
            task_id=task_id,
            to=require_field(payload, "status"),
            note=optional_str(payload, "note", ""),
        )
        return Response(_detail(_load_detail(task.pk)))


class TaskAssigneeView(AtlasAPIView):
    """Bind a queued task to an agent without granting a lease (T14 does that)."""

    def patch(self, request, task_id: str):
        payload = body(request)
        if "assigned_agent_id" not in payload:
            raise ValidationError("assigned_agent_id is required.",
                                  detail={"field": "assigned_agent_id"})
        task = task_service.set_assignee(
            task_id=task_id,
            agent_identifier=payload.get("assigned_agent_id"),
        )
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
    """`POST /tasks/{id}/archive/` with `{"archived": false}` to restore."""

    def post(self, request, task_id: str):
        payload = body(request)
        archived = payload.get("archived")
        if archived is None:
            archived = True
        if not isinstance(archived, bool):
            raise ValidationError("archived must be a boolean.",
                                  detail={"field": "archived"})
        task = (
            task_service.restore_task(task_id=task_id)
            if not archived
            else task_service.archive_task(task_id=task_id)
        )
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
# list filters / ordering  (Doc 04 §5.2)
# ---------------------------------------------------------------------------
SORT_FIELDS = {
    "priority": "priority",
    "created": "created_at",
    "updated": "updated_at",
    "age": "created_at",
}
_TRUE = {"1", "true", "yes", "on"}


def _flag(raw: str | None) -> bool | None:
    if raw is None or raw == "":
        return None
    return raw.strip().lower() in _TRUE


def _apply_filters(qs, params):
    """`status`, `q`, `agent`, `blocked`, `discovered`, `priority_min`, `archived`."""
    # Archived tasks are opt-in: the board, the matrix and the global queue all
    # read this endpoint, and none of them should show filed-away work.
    archived = _flag(params.get("archived"))
    if archived is True:
        qs = qs.filter(archived_at__isnull=False)
    elif archived is None or archived is False:
        qs = qs.filter(archived_at__isnull=True)

    raw_status = params.getlist("status") if hasattr(params, "getlist") else []
    raw_status = [part for value in raw_status for part in str(value).split(",") if part]
    if raw_status:
        qs = qs.filter(status__in=raw_status)

    query = (params.get("q") or "").strip()
    if query:
        qs = qs.filter(Q(title__icontains=query) | Q(description__icontains=query))

    agent = (params.get("agent") or "").strip()
    if agent:
        qs = qs.filter(assigned_agent_id=agent)

    blocked = _flag(params.get("blocked"))
    if blocked is True:
        # Progress-based: a blocker at 100% DoD counts as satisfied, so a task
        # whose blockers are parked in IN_REVIEW is *not* on the blocked list.
        from core.dependencies import unsatisfied_blocker_qs

        qs = qs.filter(blocked_by__in=unsatisfied_blocker_qs()).distinct()
    elif blocked is False:
        from core.dependencies import unsatisfied_blocker_qs

        qs = qs.exclude(blocked_by__in=unsatisfied_blocker_qs())

    discovered = _flag(params.get("discovered"))
    if discovered is not None:
        qs = qs.filter(is_agent_discovered=discovered)

    priority_min = params.get("priority_min")
    if priority_min not in (None, ""):
        try:
            qs = qs.filter(priority__gte=int(priority_min))
        except (TypeError, ValueError):
            raise ValidationError(
                "priority_min must be an integer.", detail={"field": "priority_min"}
            ) from None
    return qs


def _ordering(params) -> tuple[str, bool]:
    """Return `(model_field, descending)`; defaults match Doc 04 §5.2."""
    field = SORT_FIELDS.get(params.get("sort") or "priority", "priority")
    descending = (params.get("order") or "desc").lower() != "asc"
    return field, descending


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
