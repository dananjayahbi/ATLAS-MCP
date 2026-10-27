"""Asset upload / content / download routes (Doc 04 §5.8, §7)."""

from __future__ import annotations

import mimetypes
from pathlib import Path

from django.http import FileResponse, Http404, StreamingHttpResponse
from rest_framework.response import Response

from api.v1.serializers.asset import serialize_asset
from api.v1.views.base import AtlasAPIView
from core.enums import AssetKind, AssetSource
from core.errors import AssetNotFound, UnsupportedMediaType, ValidationError
from core.models import Asset
from core.paths import to_absolute_native
from core.services import tasks as task_service
from core.services.assets import register_stored_file, to_dto
from core.storage import router

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
            task.project.pk, task.pk, subdir="input", filename=_safe_name(upload.name), stream=upload
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
        response = FileResponse(path.open("rb"), content_type=asset.mime_type)
        response["Cache-Control"] = "private, max-age=3600"
        response["Content-Length"] = str(path.stat().st_size)
        if request.query_params.get("download") == "1":
            response["Content-Disposition"] = f'attachment; filename="{asset.filename}"'
        return response


class AssetDetailView(AtlasAPIView):
    def get(self, request, asset_id: str):
        return Response(to_dto(_get_asset(asset_id)))


def _safe_name(name: str | None) -> str:
    raw = Path(name or "upload.bin").name
    cleaned = "".join(ch for ch in raw if ch.isalnum() or ch in "._- ")
    return cleaned.strip() or "upload.bin"


def _get_asset(asset_id: str) -> Asset:
    try:
        asset = Asset.objects.select_related("task", "task__project").get(pk=asset_id)
    except (Asset.DoesNotExist, ValueError, TypeError):
        raise AssetNotFound("Asset not found.", detail={"asset_id": str(asset_id)}) from None
    return asset
