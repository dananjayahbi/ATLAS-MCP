"""`TaskSummaryDTO` / `TaskDetailDTO` (Doc 01 §7.3–7.4)."""

from __future__ import annotations

from rest_framework import serializers

from api.v1.serializers.asset import serialize_asset
from api.v1.serializers.checklist import serialize_checklist
from api.v1.serializers.computed import (
    age_hours,
    dependency_weight,
    dod_progress,
    iso,
    lease_seconds_overdue,
    lease_seconds_remaining,
)
from core.models import Task

RECENT_EVENT_LIMIT = 50


class TaskSummarySerializer(serializers.ModelSerializer):
    id = serializers.UUIDField(read_only=True)
    project_slug = serializers.CharField(source="project.slug", read_only=True)
    dod_progress_percent = serializers.SerializerMethodField()
    is_agent_discovered = serializers.BooleanField(read_only=True)
    is_blocked = serializers.SerializerMethodField()
    parent_task_id = serializers.SerializerMethodField()
    age_hours = serializers.SerializerMethodField()
    dependency_weight = serializers.SerializerMethodField()
    lease_seconds_remaining = serializers.SerializerMethodField()
    is_overdue = serializers.SerializerMethodField()
    lease_seconds_overdue = serializers.SerializerMethodField()

    class Meta:
        model = Task
        fields = [
            "id",
            "project_slug",
            "title",
            "status",
            "priority",
            "dod_progress_percent",
            "is_agent_discovered",
            "is_blocked",
            "parent_task_id",
            "age_hours",
            "dependency_weight",
            "assigned_agent_id",
            "lease_seconds_remaining",
            "is_overdue",
            "lease_seconds_overdue",
            "archived_at",
            "created_at",
            "updated_at",
        ]

    def get_dod_progress_percent(self, obj: Task) -> int:
        done = getattr(obj, "_dod_done", None)
        total = getattr(obj, "_dod_total", None)
        if done is not None and total is not None:
            return dod_progress(done, total)
        return obj.dod_progress_percent

    def get_is_blocked(self, obj: Task) -> bool:
        cached = getattr(obj, "_blocked", None)
        if isinstance(cached, bool):
            return cached
        return obj.is_blocked()

    def get_parent_task_id(self, obj: Task) -> str | None:
        return str(obj.parent_task_id) if obj.parent_task_id else None

    def get_age_hours(self, obj: Task) -> float:
        return age_hours(obj.created_at)

    def get_dependency_weight(self, obj: Task) -> float:
        blockers = getattr(obj, "_blocker_count", None)
        children = getattr(obj, "_child_count", None)
        if blockers is None or children is None:
            blockers = obj.blocked_by.count()
            children = obj.children.count()
        return dependency_weight(blockers, children)

    def get_lease_seconds_remaining(self, obj: Task) -> int | None:
        if obj.status != "IN_PROGRESS":
            return None
        return lease_seconds_remaining(obj.lease_expires_at)

    def get_is_overdue(self, obj: Task) -> bool:
        """True while the agent is past its own estimate and still working.

        The task stays `IN_PROGRESS` and keeps its agent — this flag is the
        operator's cue, not a state change.
        """
        return obj.status == "IN_PROGRESS" and obj.lease_overdue_at is not None

    def get_lease_seconds_overdue(self, obj: Task) -> int:
        if obj.status != "IN_PROGRESS" or obj.lease_overdue_at is None:
            return 0
        return lease_seconds_overdue(obj.lease_expires_at)


class TaskDetailSerializer(TaskSummarySerializer):
    definition_of_done = serializers.SerializerMethodField()
    blocked_by = serializers.SerializerMethodField()
    blocks = serializers.SerializerMethodField()
    child_task_ids = serializers.SerializerMethodField()
    discovered_during_task_id = serializers.SerializerMethodField()
    assets = serializers.SerializerMethodField()
    recent_events = serializers.SerializerMethodField()

    class Meta(TaskSummarySerializer.Meta):
        fields = TaskSummarySerializer.Meta.fields + [
            "description",
            "definition_of_done",
            "blocked_by",
            "blocks",
            "child_task_ids",
            "discovered_during_task_id",
            "discovery_reason",
            "suggested_priority",
            "review_summary",
            "review_notes",
            "attempt_count",
            "assets",
            "recent_events",
        ]

    def get_definition_of_done(self, obj: Task) -> list[dict]:
        return [serialize_checklist(i) for i in obj.checklist.all()]

    def get_blocked_by(self, obj: Task) -> list[str]:
        return [str(pk) for pk in obj.blocked_by.values_list("pk", flat=True)]

    def get_blocks(self, obj: Task) -> list[str]:
        return [str(pk) for pk in obj.blocks.values_list("pk", flat=True)]

    def get_child_task_ids(self, obj: Task) -> list[str]:
        return [str(pk) for pk in obj.children.values_list("pk", flat=True)]

    def get_discovered_during_task_id(self, obj: Task) -> str | None:
        return str(obj.discovered_during_task_id) if obj.discovered_during_task_id else None

    def get_assets(self, obj: Task) -> list[dict]:
        return [serialize_asset(a) for a in obj.assets.all()]

    def get_recent_events(self, obj: Task) -> list[dict]:
        from api.v1.serializers.event import serialize_event

        rows = list(obj.events.order_by("-seq")[:RECENT_EVENT_LIMIT])
        return [serialize_event(e) for e in reversed(rows)]


def serialize_task_summary(task: Task, *, now=None) -> dict:
    return {
        "id": str(task.pk),
        "project_slug": task.project.slug,
        "title": task.title,
        "status": task.status,
        "priority": task.priority,
        "dod_progress_percent": task.dod_progress_percent,
        "is_agent_discovered": task.is_agent_discovered,
        "is_blocked": task.is_blocked(),
        "parent_task_id": str(task.parent_task_id) if task.parent_task_id else None,
        "age_hours": age_hours(task.created_at, now),
        "dependency_weight": dependency_weight(
            task.blocked_by.count(), task.children.count()
        ),
        "assigned_agent_id": task.assigned_agent_id,
        "lease_seconds_remaining": (
            lease_seconds_remaining(task.lease_expires_at, now)
            if task.status == "IN_PROGRESS"
            else None
        ),
        "is_overdue": task.status == "IN_PROGRESS" and task.lease_overdue_at is not None,
        "lease_seconds_overdue": (
            lease_seconds_overdue(task.lease_expires_at, now)
            if task.status == "IN_PROGRESS" and task.lease_overdue_at is not None
            else 0
        ),
        "archived_at": iso(task.archived_at),
        "created_at": iso(task.created_at),
        "updated_at": iso(task.updated_at),
    }


def serialize_task_detail(task: Task, *, now=None, events: list | None = None) -> dict:
    payload = serialize_task_summary(task, now=now)
    payload.update(
        {
            "description": task.description,
            "definition_of_done": [serialize_checklist(i) for i in task.checklist.all()],
            "blocked_by": [str(pk) for pk in task.blocked_by.values_list("pk", flat=True)],
            "blocks": [str(pk) for pk in task.blocks.values_list("pk", flat=True)],
            "child_task_ids": [str(pk) for pk in task.children.values_list("pk", flat=True)],
            "discovered_during_task_id": (
                str(task.discovered_during_task_id) if task.discovered_during_task_id else None
            ),
            "discovery_reason": task.discovery_reason,
            "suggested_priority": task.suggested_priority,
            "review_summary": task.review_summary,
            "review_notes": task.review_notes,
            "attempt_count": task.attempt_count,
            "assets": [serialize_asset(a) for a in task.assets.all()],
            "recent_events": events or [],
        }
    )
    return payload
