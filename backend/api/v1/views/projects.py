"""Project routes (Doc 01 §12)."""

from __future__ import annotations

from django.db.models import Count
from rest_framework.response import Response

from api.v1.serializers.project import serialize_project
from api.v1.views.base import AtlasAPIView, body, optional_str, require_field
from core.errors import ProjectNotFound, ValidationError
from core.models import Project
from core.services.projects import archive_project, create_project, restore_project, update_project


class ProjectListView(AtlasAPIView):
    def get(self, request):
        projects = Project.objects.all().order_by("slug")
        return Response(
            {"items": [serialize_project(p) for p in projects], "next_cursor": None}
        )

    def post(self, request):
        payload = body(request)
        project = create_project(
            slug=require_field(payload, "slug"),
            name=require_field(payload, "name"),
            local_repo_path=require_field(payload, "local_repo_path"),
            global_rules_md=optional_str(payload, "global_rules_md", ""),
            accent_color=optional_str(payload, "accent_color", "#00F2FE"),
        )
        return Response(serialize_project(project), status=201)


class ProjectDetailView(AtlasAPIView):
    def _get(self, slug: str) -> Project:
        project = Project.objects.filter(slug=slug).first()
        if project is None:
            raise ProjectNotFound(f"No project with slug '{slug}'.", detail={"slug": slug})
        return project

    def get(self, request, slug: str):
        return Response(serialize_project(self._get(slug)))

    def patch(self, request, slug: str):
        project = self._get(slug)
        payload = body(request)
        editable = {"name", "local_repo_path", "global_rules_md", "accent_color"}
        unknown = sorted(set(payload) - editable)
        if unknown:
            raise ValidationError(
                f"Only {', '.join(sorted(editable))} can be patched; slug is immutable.",
                detail={"fields": unknown},
            )
        if payload.get("name") is not None and not str(payload["name"]).strip():
            raise ValidationError("name cannot be blank.", detail={"field": "name"})
        project = update_project(project, **payload)
        return Response(serialize_project(project))

    def delete(self, request, slug: str):
        """Doc 04 §5.1 — archive keeps everything readable, so this is reversible."""
        project = self._get(slug)
        archive_project(project)
        return Response(serialize_project(project))


class ProjectArchiveView(AtlasAPIView):
    """Explicit archive/unarchive toggle so the HUD never has to guess intent."""

    def post(self, request, slug: str):
        payload = body(request)
        project = Project.objects.filter(slug=slug).first()
        if project is None:
            raise ProjectNotFound(f"No project with slug '{slug}'.", detail={"slug": slug})
        archived = payload.get("archived")
        if archived is None:
            archived = project.archived_at is None
        if not isinstance(archived, bool):
            raise ValidationError("archived must be a boolean.",
                                  detail={"field": "archived"})
        project = restore_project(project) if not archived else archive_project(project)
        return Response(serialize_project(project))
