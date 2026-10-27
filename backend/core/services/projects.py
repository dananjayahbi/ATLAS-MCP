"""Project service: creation + folder scaffolding (Doc 01 §8 T1 prerequisites)."""

from __future__ import annotations

import json
import re
import uuid

from django.db import transaction

from core.audit import audit
from core.enums import AuditEvent
from core.errors import ValidationError
from core.models import Project
from core.storage import atomic_write_bytes, router

_SLUG = re.compile(r"^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$")
_HEX = re.compile(r"^#[0-9A-Fa-f]{6}$")


def assert_slug(slug: str) -> None:
    if not _SLUG.match(slug or ""):
        raise ValidationError(
            "slug must be 3–32 chars, lowercase alphanumeric or hyphen, "
            "and start/end with an alphanumeric.",
            detail={"field": "slug", "value": slug},
        )


@transaction.atomic
def create_project(
    *,
    slug: str,
    name: str,
    local_repo_path: str,
    global_rules_md: str = "",
    accent_color: str = "#00F2FE",
) -> Project:
    assert_slug(slug)
    if not (name or "").strip():
        raise ValidationError("name is required.", detail={"field": "name"})
    if not (local_repo_path or "").strip():
        raise ValidationError("local_repo_path is required.",
                              detail={"field": "local_repo_path"})
    if not _HEX.match(accent_color or ""):
        raise ValidationError("accent_color must be a #RRGGBB hex.",
                              detail={"field": "accent_color"})

    if Project.objects.filter(slug=slug).exists():
        raise ValidationError("A project with that slug already exists.",
                              detail={"field": "slug", "value": slug})

    project = Project.objects.create(
        id=uuid.uuid4(),
        slug=slug,
        name=name.strip(),
        local_repo_path=local_repo_path.strip(),
        global_rules_md=global_rules_md or "",
        accent_color=accent_color,
    )
    router.scaffold_project(project.pk)
    atomic_write_bytes(
        router.project_dir(project.pk) / "meta.json",
        json.dumps(
            {
                "project_id": str(project.pk),
                "slug": project.slug,
                "name": project.name,
                "local_repo_path": project.local_repo_path,
            },
            indent=2,
        ).encode("utf-8"),
    )
    audit(project=project, event=AuditEvent.PROJECT_CREATED,
          detail={"slug": project.slug})
    return project


@transaction.atomic
def update_project(project: Project, **fields) -> Project:
    allowed = {"name", "local_repo_path", "global_rules_md", "accent_color"}
    for key, value in fields.items():
        if key not in allowed:
            continue
        if key == "accent_color" and not _HEX.match(value or ""):
            raise ValidationError("accent_color must be a #RRGGBB hex.",
                                  detail={"field": "accent_color"})
        setattr(project, key, value)
    project.save()
    return project


@transaction.atomic
def archive_project(project: Project) -> Project:
    from core.ids import utcnow

    project.archived_at = utcnow()
    project.save(update_fields=["archived_at", "updated_at"])
    audit(project=project, event=AuditEvent.PROJECT_ARCHIVED,
          detail={"slug": project.slug})
    return project


@transaction.atomic
def restore_project(project: Project) -> Project:
    """Un-archive. Queued work resumes because the claim filter is `archived_at IS NULL`."""
    project.archived_at = None
    project.save(update_fields=["archived_at", "updated_at"])
    audit(project=project, event=AuditEvent.PROJECT_RESTORED,
          detail={"slug": project.slug})
    return project
