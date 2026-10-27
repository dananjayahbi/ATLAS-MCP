"""`DiscoveryDTO` (Doc 01 §7.6), including the browser-loadable `assets[]`."""

from __future__ import annotations

from rest_framework import serializers

from api.v1.serializers.asset import serialize_asset
from api.v1.serializers.computed import iso
from core.models import Task


class DiscoverySerializer(serializers.ModelSerializer):
    task_id = serializers.UUIDField(source="id", read_only=True)
    project_slug = serializers.CharField(source="project.slug", read_only=True)
    discovered_during_task_id = serializers.SerializerMethodField()
    assets = serializers.SerializerMethodField()
    screenshot_absolute_paths = serializers.SerializerMethodField()

    class Meta:
        model = Task
        fields = [
            "task_id",
            "project_slug",
            "title",
            "description",
            "status",
            "suggested_priority",
            "priority",
            "discovered_during_task_id",
            "discovered_by_agent",
            "discovery_reason",
            "assets",
            "screenshot_absolute_paths",
            "created_at",
        ]

    def get_discovered_during_task_id(self, obj: Task) -> str | None:
        return str(obj.discovered_during_task_id) if obj.discovered_during_task_id else None

    def get_assets(self, obj: Task) -> list[dict]:
        return [serialize_asset(a) for a in obj.assets.all()]

    def get_screenshot_absolute_paths(self, obj: Task) -> list[str]:
        from core.paths import to_absolute_native

        return [
            to_absolute_native(a.relative_path)
            for a in obj.assets.all()
            if a.kind in {"INPUT_SCREENSHOT", "VERIFICATION_IMAGE", "ANNOTATED_CANVAS"}
        ]


def serialize_discovery(task: Task) -> dict:
    from core.paths import to_absolute_native

    assets = list(task.assets.all())
    return {
        "task_id": str(task.pk),
        "project_slug": task.project.slug,
        "title": task.title,
        "description": task.description,
        "status": task.status,
        "suggested_priority": task.suggested_priority if task.suggested_priority is not None else task.priority,
        "priority": task.priority,
        "discovered_during_task_id": (
            str(task.discovered_during_task_id) if task.discovered_during_task_id else None
        ),
        "discovered_by_agent": task.discovered_by_agent,
        "discovery_reason": task.discovery_reason,
        "assets": [serialize_asset(a) for a in assets],
        "screenshot_absolute_paths": [
            to_absolute_native(a.relative_path)
            for a in assets
            if a.kind in {"INPUT_SCREENSHOT", "VERIFICATION_IMAGE", "ANNOTATED_CANVAS"}
        ],
        "created_at": iso(task.created_at),
    }
