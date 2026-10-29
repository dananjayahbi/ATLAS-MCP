"""`ProjectDTO` (Doc 01 §7.2)."""

from __future__ import annotations

from rest_framework import serializers

from api.v1.serializers.computed import iso
from core.models import Project
from core.services.telemetry import project_counters


class ProjectSerializer(serializers.ModelSerializer):
    id = serializers.UUIDField(read_only=True)
    counters = serializers.SerializerMethodField()
    active_agent_id = serializers.SerializerMethodField()
    last_event_at = serializers.SerializerMethodField()
    claim_slots_used = serializers.SerializerMethodField()

    class Meta:
        model = Project
        fields = [
            "contract_version",
            "id",
            "slug",
            "name",
            "local_repo_path",
            "accent_color",
            "global_rules_md",
            "claim_limit",
            "claim_slots_used",
            "archived_at",
            "created_at",
            "updated_at",
            "counters",
            "active_agent_id",
            "last_event_at",
        ]
        read_only_fields = ["id", "slug", "created_at", "updated_at", "archived_at"]

    contract_version = serializers.SerializerMethodField()

    def get_contract_version(self, obj) -> str:
        from api.common.renderers import CONTRACT_VERSION

        return CONTRACT_VERSION

    def get_claim_slots_used(self, obj: Project) -> int:
        from core.leases import claim_slots_used

        return claim_slots_used(obj)

    def get_counters(self, obj: Project) -> dict:
        return project_counters(obj)

    def get_active_agent_id(self, obj: Project) -> str | None:
        from core.enums import TaskStatus

        return (
            obj.tasks.filter(status=TaskStatus.IN_PROGRESS)
            .exclude(assigned_agent_id__isnull=True)
            .values_list("assigned_agent_id", flat=True)
            .first()
            or None
        )

    def get_last_event_at(self, obj: Project) -> str | None:
        latest = obj.events.order_by("-seq").values_list("created_at", flat=True).first()
        return iso(latest)


def serialize_project(project: Project, *, counters: dict | None = None) -> dict:
    from api.common.renderers import CONTRACT_VERSION
    from core.enums import TaskStatus
    from core.leases import claim_slots_used

    active_agent = (
        project.tasks.filter(status=TaskStatus.IN_PROGRESS)
        .exclude(assigned_agent_id__isnull=True)
        .values_list("assigned_agent_id", flat=True)
        .first()
    )
    last_event = project.events.order_by("-seq").values_list("created_at", flat=True).first()
    return {
        "contract_version": CONTRACT_VERSION,
        "id": str(project.pk),
        "slug": project.slug,
        "name": project.name,
        "local_repo_path": project.local_repo_path,
        "accent_color": project.accent_color,
        "global_rules_md": project.global_rules_md,
        # `claim_limit == 0` reads as "unlimited"; the UI renders it that way.
        "claim_limit": project.claim_limit,
        "claim_slots_used": claim_slots_used(project),
        "archived_at": iso(project.archived_at),
        "created_at": iso(project.created_at),
        "updated_at": iso(project.updated_at),
        "counters": counters or project_counters(project),
        "active_agent_id": active_agent,
        "last_event_at": iso(last_event),
    }
