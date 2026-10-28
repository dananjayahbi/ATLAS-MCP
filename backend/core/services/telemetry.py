"""Telemetry & priority-matrix aggregation (Doc 01 §7.7)."""

from __future__ import annotations

from datetime import timedelta

from django.db.models import Count, Max, Q

from core.enums import TaskStatus
from core.ids import iso_z, utcnow
from core.models import Project, Task


def _age_hours(created_at, now) -> float:
    if created_at is None:
        return 0.0
    return round((now - created_at).total_seconds() / 3600, 2)


def priority_matrix(*, project_slug: str | None = None) -> dict:
    """`PriorityMatrixPointDTO[]` (Doc 01 §7.7)."""
    now = utcnow()
    qs = (
        Task.objects.filter(archived_at__isnull=True)
        .select_related("project")
        .annotate(
            blocker_count=Count("blocked_by", distinct=True),
            child_count=Count("children", distinct=True),
            unsatisfied_blockers=Count(
                "blocked_by",
                filter=~Q(blocked_by__status=TaskStatus.COMPLETED),
                distinct=True,
            ),
            dod_total=Count("checklist", distinct=True),
            dod_done=Count("checklist", filter=Q(checklist__completed=True), distinct=True),
        )
    )
    if project_slug:
        qs = qs.filter(project__slug=project_slug)

    points = []
    for task in qs:
        dod = round(task.dod_done / task.dod_total * 100) if task.dod_total else 0
        points.append(
            {
                "task_id": str(task.pk),
                "title": task.title,
                "project_slug": task.project.slug,
                "status": task.status,
                "priority": task.priority,
                "age_hours": _age_hours(task.created_at, now),
                "dependency_weight": round(
                    task.blocker_count + 0.5 * task.child_count, 2
                ),
                "is_blocked": task.unsatisfied_blockers > 0,
                "is_agent_discovered": task.is_agent_discovered,
                "dod_progress_percent": dod,
            }
        )
    return {
        "points": points,
        "axes": {
            "x": "age_hours",
            "x_alternate": "dependency_weight",
            "y": "priority",
            "y_max": 100,
        },
    }


def telemetry_summary() -> dict:
    """`TelemetrySummaryDTO` (Doc 01 §7.7)."""
    now = utcnow()
    day_ago = now - timedelta(hours=24)
    five_min = now + timedelta(minutes=5)

    by_status = {s.value: 0 for s in TaskStatus}
    for row in Task.objects.values("status").annotate(total=Count("id")).order_by():
        by_status[row["status"]] = row["total"]

    projects = []
    for project in Project.objects.all().order_by("slug"):
        counts = project.status_counts()
        projects.append(
            {
                "slug": project.slug,
                "health_percent": project.health_percent(),
                "active_agent_id": _active_agent(project.pk),
                "in_progress": counts.get(TaskStatus.IN_PROGRESS.value, 0),
            }
        )

    oldest_pending = (
        Task.objects.filter(status=TaskStatus.PENDING).aggregate(m=Max("created_at"))["m"]
    )
    oldest_hours = 0.0
    if oldest_pending is not None:
        oldest_hours = round((now - oldest_pending).total_seconds() / 3600, 2)

    return {
        "projects": projects,
        "tasks_by_status": by_status,
        "discoveries_pending": Task.objects.filter(
            status=TaskStatus.PENDING_APPROVAL
        ).count(),
        "oldest_pending_age_hours": oldest_hours,
        "leases_expiring_within_5m": Task.objects.filter(
            status=TaskStatus.IN_PROGRESS,
            lease_expires_at__lte=five_min,
            lease_expires_at__gt=now,
        ).count(),
        "throughput_last_24h": Task.objects.filter(
            status=TaskStatus.COMPLETED, completed_at__gte=day_ago
        ).count(),
        "generated_at": iso_z(now),
    }


def _active_agent(project_id):
    row = (
        Task.objects.filter(project_id=project_id, status=TaskStatus.IN_PROGRESS)
        .exclude(assigned_agent_id__isnull=True)
        .values_list("assigned_agent_id", flat=True)
        .first()
    )
    return row or None


def project_counters(project) -> dict:
    """`ProjectDTO.counters` (Doc 01 §7.2)."""
    counts = project.status_counts()
    return {
        "pending": counts.get(TaskStatus.PENDING.value, 0),
        "in_progress": counts.get(TaskStatus.IN_PROGRESS.value, 0),
        "in_review": counts.get(TaskStatus.IN_REVIEW.value, 0),
        "completed": counts.get(TaskStatus.COMPLETED.value, 0),
        "pending_approval": counts.get(TaskStatus.PENDING_APPROVAL.value, 0),
        "health_percent": project.health_percent(),
    }
