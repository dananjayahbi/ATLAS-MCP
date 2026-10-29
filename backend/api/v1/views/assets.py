"""Asset upload / content / download routes (Doc 04 §5.8, §7)."""

from __future__ import annotations

import mimetypes
from pathlib import Path
from uuid import uuid4

from django.http import FileResponse, Http404, HttpResponseNotModified, StreamingHttpResponse
from rest_framework.response import Response

from api.common.pagination import resolve_page_size
from api.v1.serializers.asset import serialize_asset
from api.v1.views.base import AtlasAPIView
from core.enums import AssetKind, AssetSource
from core.errors import AssetNotFound, PathOutOfScope, UnsupportedMediaType, ValidationError
from core.models import Asset
from core.paths import resolve_under, to_absolute_native
from core.services import tasks as task_service
from core.services.assets import register_stored_file, to_dto
from core.storage import _sha256_of, atomic_write_bytes, router

ALLOWED_MIME = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "text/plain": ".txt",
    "text/markdown": ".md",
}

_SNIFF = (
    (b"\x89PNG\r\n\x1a\n", "image/png"),
    (b"\xff\xd8\xff", "image/jpeg"),
    (b"RIFF", "image/webp"),
)


def sniff_mime(head: bytes, declared: str | None, filename: str) -> str:
    """Prefer magic bytes; fall back to the declared type only for text."""
    for magic, mime in _SNIFF:
        if head.startswith(magic):
            if mime == "image/webp" and head[8:12] != b"WEBP":
                continue
            return mime
    if declared in {"text/plain", "text/markdown"}:
        return declared
    guessed, _ = mimetypes.guess_type(filename)
    if guessed in ALLOWED_MIME:
        return guessed
    raise UnsupportedMediaType(
        f"{declared or 'unknown'} is not an allowed upload type.",
        detail={"allowed": sorted(ALLOWED_MIME)},
    )


class AssetUploadView(AtlasAPIView):
    throttle_family = "upload"

    def post(self, request):
        upload = request.FILES.get("file")
        if upload is None:
            raise ValidationError("A multipart 'file' field is required.",
                                  detail={"field": "file"})
        task_id = request.data.get("task_id") or request.query_params.get("task_id")
        kind = request.data.get("kind") or AssetKind.USER_CONTEXT
        if kind not in AssetKind.values:
            raise ValidationError("Unknown asset kind.", detail={"field": "kind"})
        task = task_service.get_task(task_id)

        head = upload.read(16)
        upload.seek(0)
        mime = sniff_mime(head, upload.content_type, upload.name or "upload.bin")

        stored = router.write_task_stream(
            task.project.pk,
            task.pk,
            subdir="input",
            # Every upload gets its own file. Two screenshots both called
            # `shot.png` are two pieces of evidence; sharing one path made the
            # second overwrite the first and dedupe onto the same Asset row.
            filename=_unique_name(
                router.task_input_dir(task.project.pk, task.pk), _safe_name(upload.name)
            ),
            stream=upload,
        )
        asset = register_stored_file(
            task=task, stored=stored, kind=kind, mime_type=mime, source=AssetSource.HUMAN
        )
        return Response(serialize_asset(asset), status=201)


class AssetContentView(AtlasAPIView):
    def get(self, request, asset_id: str):
        asset = _get_asset(asset_id)
        try:
            path = router.open_task_file(asset.relative_path)
        except FileNotFoundError:
            raise AssetNotFound("Asset bytes are missing on disk.",
                                detail={"asset_id": str(asset.pk)}) from None

        # Burn-in rewrites these bytes under a stable id, so a long `max-age`
        # would keep serving the pre-markup image. The sha is the version: it
        # changes exactly when the file does.
        etag = f'"{asset.sha256}"'
        if etag in (request.headers.get("If-None-Match") or ""):
            return HttpResponseNotModified()

        response = FileResponse(path.open("rb"), content_type=asset.mime_type)
        response["ETag"] = etag
        response["Cache-Control"] = "private, no-cache"
        response["Content-Length"] = str(path.stat().st_size)
        if request.query_params.get("download") == "1":
            response["Content-Disposition"] = f'attachment; filename="{asset.filename}"'
        return response


class AssetThumbnailView(AtlasAPIView):
    """`GET /assets/{id}/thumbnail` — the downscaled sibling of an image asset.

    Falls through to the original bytes when no thumbnail exists (non-images,
    undecodable uploads, assets written before thumbnails existed), so callers
    can always point an `<img>` here without special-casing.
    """

    def get(self, request, asset_id: str):
        asset = _get_asset(asset_id)
        relative = asset.thumbnail_relative_path or asset.relative_path
        try:
            path = router.open_task_file(relative)
        except FileNotFoundError:
            raise AssetNotFound(
                "Asset bytes are missing on disk.",
                detail={"asset_id": str(asset.pk)},
            ) from None

        # A thumbnail is derived from the original bytes, so the original's sha
        # still busts the cache when burn-in rewrites the file.
        etag = f'"{asset.sha256}-thumb"'
        if etag in (request.headers.get("If-None-Match") or ""):
            return HttpResponseNotModified()

        mime = "image/jpeg" if path.suffix.lower() in {".jpg", ".jpeg"} else (
            "image/png" if path.suffix.lower() == ".png" else asset.mime_type
        )
        response = FileResponse(path.open("rb"), content_type=mime)
        response["ETag"] = etag
        response["Cache-Control"] = "private, no-cache"
        response["Content-Length"] = str(path.stat().st_size)
        return response


class AssetDetailView(AtlasAPIView):
    def get(self, request, asset_id: str):
        return Response(to_dto(_get_asset(asset_id)))

    def delete(self, request, asset_id: str):
        """Remove one attachment from a task.

        The operator manages images from the task editor (§7.2 row 3), so a
        misfiled screenshot must be removable. Rows go first, bytes second: a
        file whose row is gone is an orphan the sweep can reclaim, whereas a row
        whose file is gone is a broken thumbnail.
        """
        asset = _get_asset(asset_id)
        relative = asset.relative_path
        thumbnail = asset.thumbnail_relative_path
        documents = _annotation_document_paths(asset)
        asset.delete()
        _remove_stored_file(relative)
        if thumbnail:
            _remove_stored_file(thumbnail)
        # The stroke side-car is keyed by asset id, so nothing would ever read it
        # again once the row is gone.
        for document in documents:
            _remove_stored_file(str(document))
        return Response(status=204)


IMAGE_KINDS = (
    AssetKind.INPUT_SCREENSHOT,
    AssetKind.ANNOTATED_CANVAS,
    AssetKind.VERIFICATION_IMAGE,
)

#: Thumbnails the board shows per card before the "+n" tail.
PREVIEWS_PER_TASK = 3


class ProjectAssetPreviewView(AtlasAPIView):
    """`GET /projects/{slug}/assets/` — the board thumbnail grid.

    `TaskSummaryDTO` is token-budgeted and frozen (Doc 01 §7.3), so previews
    travel on their own cache entry instead of widening every task row. Only
    image kinds are returned, newest first, capped per task.

    `?task_id=<uuid>` widens the cap so the task editor can list every image on
    one task; the board never passes it and therefore keeps its 3-up grid.
    """

    def get(self, request, slug: str):
        project = task_service.get_project(slug)
        limit = resolve_page_size(request.query_params.get("limit"), default=60)
        per_task = PREVIEWS_PER_TASK
        rows = (
            Asset.objects.filter(task__project=project, kind__in=IMAGE_KINDS)
            .select_related("task")
            .order_by("task_id", "-created_at")
        )
        task_id_param = (request.query_params.get("task_id") or "").strip()
        if task_id_param:
            rows = rows.filter(task_id=task_id_param)
            # The task editor lists every image on one task, and uploads are
            # uncapped, so this read must not truncate a long attachment list.
            per_task = None

        grouped: dict[str, list[dict]] = {}
        counts: dict[str, int] = {}
        for asset in rows.iterator(chunk_size=500):
            task_id = str(asset.task_id)
            total = counts.get(task_id, 0) + 1
            counts[task_id] = total
            if per_task is not None and total > per_task:
                continue
            grouped.setdefault(task_id, []).append(
                {
                    "id": str(asset.pk),
                    "kind": asset.kind,
                    "filename": asset.filename,
                    "mime_type": asset.mime_type,
                    "byte_size": asset.byte_size,
                    "version": asset.sha256,
                    "created_at": _iso(asset.created_at),
                    "url": f"/api/v1/assets/{asset.pk}/content",
                    "thumbnail_url": (
                        f"/api/v1/assets/{asset.pk}/thumbnail"
                        if asset.thumbnail_relative_path
                        else None
                    ),
                }
            )
            if len(grouped) >= limit:
                break

        return Response(
            {
                "items": [
                    {"task_id": task_id, "images": images, "total": counts[task_id]}
                    for task_id, images in grouped.items()
                ],
                "next_cursor": None,
            }
        )


class AssetAnnotationView(AtlasAPIView):
    """Flatten-on-save for the markup modal (Doc 07 §9.5, operator extension).

    Two writes happen on save:

    1. the flattened PNG is stored as a new `ANNOTATED_CANVAS` asset, so the
       evidence trail is append-only and nothing the agent relied on vanishes;
    2. the editable stroke document is stored as a sibling `USER_CONTEXT` JSON
       asset so the modal can reopen the markup and keep editing.

    `replace_source=1` additionally rewrites the source asset's own bytes in
    place — that is the "burn it onto the image" the operator asks for, and it
    is why the thumbnail and the agent's view agree after a save.

    `replace_only=1` skips the `ANNOTATED_CANVAS` copy entirely: the markup
    modal's job is to leave behind one edited image, not the original plus a
    near-identical duplicate. The stroke document is still stored, so the
    markup stays editable.
    """

    throttle_family = "upload"

    def get(self, request, asset_id: str):
        source = _get_asset(asset_id)
        document = _read_annotation_document(source)

        annotated = (
            Asset.objects.filter(task=source.task, kind=AssetKind.ANNOTATED_CANVAS)
            .order_by("-created_at")
            .first()
        )
        return Response(
            {
                "source_asset_id": str(source.pk),
                "document": document,
                "annotated_asset": serialize_asset(annotated) if annotated else None,
            }
        )

    def post(self, request, asset_id: str):
        source = _get_asset(asset_id)
        if not source.mime_type.startswith("image/"):
            raise UnsupportedMediaType(
                "Only images can be annotated.",
                detail={"mime_type": source.mime_type},
            )
        upload = request.FILES.get("file")
        if upload is None:
            raise ValidationError("A multipart 'file' field is required.",
                                  detail={"field": "file"})

        head = upload.read(16)
        upload.seek(0)
        mime = sniff_mime(head, upload.content_type, upload.name or "annotated_canvas.png")

        replace = str(request.data.get("replace_source") or "").lower() in {"1", "true", "yes"}
        replace_only = str(request.data.get("replace_only") or "").lower() in {"1", "true", "yes"}
        if replace_only:
            replace = True

        stem = _safe_name(Path(source.filename).stem)
        stored = router.write_task_stream(
            source.task.project_id,
            source.task_id,
            subdir="input",
            filename=f"annotated_{stem}.png",
            stream=upload,
        )

        document = request.data.get("document")
        if isinstance(document, str) and document.strip():
            _write_annotation_document(source, document)

        if replace_only:
            _replace_bytes(source, stored)
            # The staged file is only an intermediate for the byte swap; keeping
            # it would leave an unreferenced PNG next to the original.
            _remove_stored_file(stored.relative_path)
            # The strokes are pixels now. Keeping the document would paint them
            # a second time when the image is reopened, which reads as "the
            # highlight did not save" (it saved, then drew itself again on top).
            _clear_annotation_document(source)
            return Response(
                {
                    "asset": serialize_asset(Asset.objects.get(pk=source.pk)),
                    "source_asset": serialize_asset(Asset.objects.get(pk=source.pk)),
                    "replaced_source": True,
                    "burned": True,
                },
                status=200,
            )

        annotated = register_stored_file(
            task=source.task,
            stored=stored,
            kind=AssetKind.ANNOTATED_CANVAS,
            mime_type=mime,
            source=AssetSource.HUMAN,
        )

        if replace:
            _replace_bytes(source, stored)

        return Response(
            {
                "asset": serialize_asset(annotated),
                "source_asset": serialize_asset(
                    Asset.objects.get(pk=source.pk)  # refreshed: sha/size may have changed
                ),
                "replaced_source": replace,
            },
            status=201,
        )


def _annotation_document_name(source: Asset) -> str:
    # Keyed by asset id, not filename: two uploads called `shot.png` on the same
    # task are different images and must not share one stroke document.
    return f"canvas_{source.pk}.json"


def _legacy_annotation_document_name(source: Asset) -> str:
    return f"annotated_{_safe_name(Path(source.filename).stem)}.canvas.json"


def _annotation_document_path(source: Asset) -> Path:
    return router.task_input_dir(source.task.project_id, source.task_id) / _annotation_document_name(source)


def _annotation_document_paths(source: Asset) -> tuple[Path, ...]:
    """Current path first, then the filename-keyed location written before ids."""
    directory = router.task_input_dir(source.task.project_id, source.task_id)
    return (
        directory / _annotation_document_name(source),
        directory / _legacy_annotation_document_name(source),
    )


def _read_annotation_document(source: Asset) -> dict | None:
    import json

    for path in _annotation_document_paths(source):
        if not path.is_file():
            continue
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if isinstance(payload, dict):
            return payload
    return None


def _write_annotation_document(source: Asset, raw: str) -> None:
    import json

    from core.storage import atomic_write_bytes

    try:
        parsed = json.loads(raw)
    except ValueError:
        raise ValidationError("document must be valid JSON.",
                              detail={"field": "document"}) from None
    if not isinstance(parsed, dict):
        raise ValidationError("document must be a JSON object.",
                              detail={"field": "document"})
    encoded = json.dumps(parsed, separators=(",", ":")).encode("utf-8")
    if len(encoded) > 2 * 1024 * 1024:
        from core.errors import PayloadTooLarge

        raise PayloadTooLarge("document exceeds 2 MB.", detail={"max_bytes": 2 * 1024 * 1024})
    atomic_write_bytes(_annotation_document_path(source), encoded)


def _clear_annotation_document(source: Asset) -> None:
    """Drop the editable strokes once they are pixels on the image."""
    for path in _annotation_document_paths(source):
        try:
            path.unlink(missing_ok=True)
        except OSError:
            # Losing the discard is harmless: the next save overwrites it.
            pass


def _replace_bytes(source: Asset, stored) -> None:
    """Overwrite the source asset's bytes, keeping its id stable for every link."""
    from core.services.assets import refresh_thumbnail

    target = Path(to_absolute_native(source.relative_path))
    atomic_write_bytes(target, Path(stored.absolute_path).read_bytes())
    sha, size = _sha256_of(target)
    source.sha256 = sha
    source.byte_size = size
    source.save(update_fields=["sha256", "byte_size"])
    # The pixels changed, so the derived thumbnail has to follow or the board
    # would keep showing the pre-markup image.
    refresh_thumbnail(source)


def _iso(value):
    """Local import keeps `core.ids` out of the module import cycle."""
    from core.ids import iso_z

    return iso_z(value)


def _safe_name(name: str | None) -> str:
    raw = Path(name or "upload.bin").name
    cleaned = "".join(ch for ch in raw if ch.isalnum() or ch in "._- ")
    return cleaned.strip() or "upload.bin"


def _unique_name(directory: Path, filename: str) -> str:
    """`shot.png` → `shot (2).png` when the first name is already taken."""
    if not (directory / filename).exists():
        return filename
    stem, suffix = Path(filename).stem, Path(filename).suffix
    for ordinal in range(2, 1000):
        alternative = f"{stem} ({ordinal}){suffix}"
        if not (directory / alternative).exists():
            return alternative
    # Pathological directory: fall back to a random suffix rather than overwrite.
    return f"{stem}-{uuid4().hex[:8]}{suffix}"


def _remove_stored_file(relative_path: str) -> None:
    """Best-effort unlink: a missing file is already the desired end state."""
    try:
        resolve_under(relative_path).unlink(missing_ok=True)
    except (OSError, PathOutOfScope):
        # The row is already gone; a locked file is a sweep problem, not a 500.
        pass


def _get_asset(asset_id: str) -> Asset:
    try:
        asset = Asset.objects.select_related("task", "task__project").get(pk=asset_id)
    except (Asset.DoesNotExist, ValueError, TypeError):
        raise AssetNotFound("Asset not found.", detail={"asset_id": str(asset_id)}) from None
    return asset
