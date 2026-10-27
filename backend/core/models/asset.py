"""`Asset` — Doc 01 §6.6."""

from __future__ import annotations

import uuid

from django.db import models

from core.enums import AssetKind, AssetSource


class Asset(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    task = models.ForeignKey(
        "core.Task", on_delete=models.CASCADE, related_name="assets"
    )
    kind = models.CharField(max_length=24, choices=AssetKind.choices)
    #: POSIX-style, relative to ATLAS_STORAGE_ROOT (Doc 01 §11 dual-path rule).
    relative_path = models.CharField(max_length=1024, unique=True)
    filename = models.CharField(max_length=255)
    mime_type = models.CharField(max_length=120)
    byte_size = models.BigIntegerField()
    sha256 = models.CharField(max_length=64)
    source = models.CharField(max_length=8, choices=AssetSource.choices)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "core_asset"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["task", "kind"], name="asset_task_kind_idx"),
            models.Index(fields=["sha256"], name="asset_sha_idx"),
        ]
        constraints = [
            models.CheckConstraint(
                check=models.Q(byte_size__gte=0), name="asset_size_nonneg"
            ),
        ]

    def __str__(self) -> str:  # pragma: no cover
        return f"Asset({self.filename})"
