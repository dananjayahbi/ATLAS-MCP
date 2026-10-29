"""Asset registration + ingest (Doc 02 §10)."""

from __future__ import annotations

import logging
from pathlib import Path

from django.db import transaction

from core.enums import AssetKind, AssetSource
from core.models import Asset, Task
from core.paths import to_absolute_native, to_posix_relative
from core.storage import StoredFile, atomic_write_bytes

logger = logging.getLogger("atlas.services.assets")


def asset_url(asset: Asset) -> str:
    return f"/api/v1/assets/{asset.pk}/content"


def thumbnail_url(asset: Asset) -> str | None:
    """URL of the downscaled sibling, or `None` when the asset has no thumbnail."""
    if not asset.thumbnail_relative_path:
        return None
    return f"/api/v1/assets/{asset.pk}/thumbnail"


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
        # Small variant for board tiles and list rows; the UI falls back to
        # `url` when this is null (non-images, undecodable uploads).
        "thumbnail_url": thumbnail_url(asset),
        # Content hash: burn-in rewrites an asset's bytes under a stable id, so
        # this is the only reliable cache-buster for the rendered image.
        "version": asset.sha256,
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

    # Written before the row for the same reason the original is (Doc 01 §11):
    # a row that advertises a thumbnail must point at a real file.
    thumbnail = write_thumbnail(stored, mime_type=mime_type)

    existing = Asset.objects.filter(relative_path=stored.relative_path).first()
    if existing is not None:
        # Same bytes on disk: refresh metadata, keep the id stable for the UI.
        fields = ["sha256", "byte_size", "mime_type", "kind"]
        existing.sha256 = stored.sha256
        existing.byte_size = stored.byte_size
        existing.mime_type = mime_type
        existing.kind = kind
        if thumbnail and thumbnail != existing.thumbnail_relative_path:
            existing.thumbnail_relative_path = thumbnail
            fields.append("thumbnail_relative_path")
        existing.save(update_fields=fields)
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
        thumbnail_relative_path=thumbnail,
    )


def find_by_sha256(task: Task, sha: str) -> Asset | None:
    return Asset.objects.filter(task=task, sha256=sha).first()


def write_thumbnail(stored: StoredFile, *, mime_type: str) -> str:
    """Write the downscaled sibling of `stored` and return its relative path.

    Returns `""` when the bytes are not an image or cannot be decoded — the
    caller then serves the original, which is slower but never broken.
    """
    if not mime_type.startswith("image/"):
        return ""

    from core.services.thumbnails import generate_thumbnail_bytes, thumbnail_filename

    thumb = generate_thumbnail_bytes(stored.absolute_path)
    if thumb is None:
        return ""

    target = Path(stored.absolute_path).with_name(
        thumbnail_filename(stored.filename, thumb.suffix)
    )
    try:
        atomic_write_bytes(target, thumb.data)
    except Exception as exc:  # noqa: BLE001 - a missing thumbnail must not fail ingest
        logger.warning("thumbnail write failed for %s: %s", stored.filename, exc)
        return ""
    return to_posix_relative(target)


def refresh_thumbnail(asset: Asset) -> None:
    """Regenerate an asset's thumbnail after its bytes changed in place."""
    from core.paths import resolve_under

    relative = write_thumbnail(
        StoredFile(
            relative_path=asset.relative_path,
            absolute_path=str(resolve_under(asset.relative_path)),
            filename=asset.filename,
            byte_size=asset.byte_size,
            sha256=asset.sha256,
        ),
        mime_type=asset.mime_type,
    )
    if relative != asset.thumbnail_relative_path:
        asset.thumbnail_relative_path = relative
        asset.save(update_fields=["thumbnail_relative_path"])


def task_assets(task: Task, *, kind: str | None = None) -> list[Asset]:
    qs = Asset.objects.filter(task=task)
    if kind:
        qs = qs.filter(kind=kind)
    return list(qs.order_by("-created_at"))
