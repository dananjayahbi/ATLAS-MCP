"""Project routes (Doc 01 §12)."""

from __future__ import annotations

from django.db.models import Count
from rest_framework.response import Response

from api.v1.serializers.project import serialize_project
from api.v1.views.base import AtlasAPIView, body, optional_str, require_field
from core.errors import InvalidTransition, ProjectNotFound, ValidationError
from core.models import Project
from core.services.projects import (
    archive_project,
    create_project,
    purge_project,
    restore_project,
    update_project,
)

_TRUE = {"1", "true", "yes", "on"}
_FALSE = {"0", "false", "no", "off"}


def _archive_flag(raw: str | None) -> bool | None:
    """`?archived=` tri-state: `True` archived only, `False` active only, `None` both."""
    if raw is None or raw == "":
        return None
    value = raw.strip().lower()
    if value in _TRUE:
        return True
    if value in _FALSE:
        return False
    raise ValidationError("archived must be a boolean.", detail={"field": "archived"})


class ProjectListView(AtlasAPIView):
    """`GET/POST /projects/`.

    The board, the rail and the switcher all read this list, so archived
    projects are hidden by default — otherwise every surface would have to
    re-filter what the API already knows. `?archived=1` is the archive page's
    read; `?archived=all` restores the historical "everything" view.
    """

    def get(self, request):
        projects = Project.objects.all().order_by("slug")
        raw = (request.query_params.get("archived") or "").strip().lower()
        if raw == "all":
            pass
        else:
            archived = _archive_flag(request.query_params.get("archived"))
            if archived is True:
                projects = projects.exclude(archived_at__isnull=True)
            elif archived is None or archived is False:
                projects = projects.filter(archived_at__isnull=True)
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
        """Doc 04 §5.1 — archive keeps everything readable, so this is reversible.

        A request that echoes the slug back (`?confirm=<slug>`) means "purge":
        the operator has already archived the project and now wants it gone.
        Without the confirmation this stays the documented archive verb, so an
        accidental DELETE can never destroy evidence.
        """
        project = self._get(slug)
        if (request.query_params.get("confirm") or "").strip() == slug:
            purge_project(project)
            return Response(status=204)
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
