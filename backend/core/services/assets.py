"""Asset registration + ingest (Doc 02 §10)."""

from __future__ import annotations

from django.db import transaction

from core.enums import AssetKind, AssetSource
from core.models import Asset, Task
from core.paths import to_absolute_native
from core.storage import StoredFile


def asset_url(asset: Asset) -> str:
    return f"/api/v1/assets/{asset.pk}/content"


def to_dto(asset: Asset) -> dict:
    """`AssetDTO` (Doc 01 §7.4)."""
    return {
        "id": str(asset.pk),
        "kind": asset.kind,
        "filename": asset.filename,
        "mime_type": asset.mime_type,
        "byte_size": asset.byte_size,
        "source": asset.source,
        "absolute_path": to_absolute_native(asset.relative_path),
        "url": asset_url(asset),
        "created_at": _iso(asset.created_at),
    }


def _iso(value):
    from core.ids import iso_z

    return iso_z(value)


@transaction.atomic
def register_stored_file(
    *,
    task: Task,
    stored: StoredFile,
    kind: str,
    mime_type: str,
    source: str,
) -> Asset:
    """Create (or dedupe) the Asset row for an already-written file."""
    if kind not in AssetKind.values:
        raise ValueError(f"unknown asset kind: {kind}")
    if source not in AssetSource.values:
        raise ValueError(f"unknown asset source: {source}")

    existing = Asset.objects.filter(relative_path=stored.relative_path).first()
    if existing is not None:
        # Same bytes on disk: refresh metadata, keep the id stable for the UI.
        if existing.sha256 != stored.sha256 or existing.byte_size != stored.byte_size:
            existing.sha256 = stored.sha256
            existing.byte_size = stored.byte_size
            existing.mime_type = mime_type
            existing.kind = kind
            existing.save(update_fields=["sha256", "byte_size", "mime_type", "kind"])
        return existing

    return Asset.objects.create(
        task=task,
        kind=kind,
        relative_path=stored.relative_path,
        filename=stored.filename,
        mime_type=mime_type,
        byte_size=stored.byte_size,
        sha256=stored.sha256,
        source=source,
    )


def find_by_sha256(task: Task, sha: str) -> Asset | None:
    return Asset.objects.filter(task=task, sha256=sha).first()


def task_assets(task: Task, *, kind: str | None = None) -> list[Asset]:
    qs = Asset.objects.filter(task=task)
    if kind:
        qs = qs.filter(kind=kind)
    return list(qs.order_by("-created_at"))
