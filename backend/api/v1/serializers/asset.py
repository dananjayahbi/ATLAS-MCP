"""`AssetDTO` (Doc 01 §7.4)."""

from __future__ import annotations

from rest_framework import serializers

from core.models import Asset
from core.services.assets import to_dto


class AssetSerializer(serializers.ModelSerializer):
    id = serializers.UUIDField(read_only=True)
    absolute_path = serializers.SerializerMethodField()
    url = serializers.SerializerMethodField()
    version = serializers.SerializerMethodField()

    class Meta:
        model = Asset
        fields = [
            "id",
            "kind",
            "filename",
            "mime_type",
            "byte_size",
            "source",
            "absolute_path",
            "url",
            "version",
            "created_at",
        ]

    def get_absolute_path(self, obj: Asset) -> str:
        from core.paths import to_absolute_native

        return to_absolute_native(obj.relative_path)

    def get_url(self, obj: Asset) -> str:
        return f"/api/v1/assets/{obj.pk}/content"

    def get_version(self, obj: Asset) -> str:
        return obj.sha256


def serialize_asset(asset: Asset) -> dict:
    return to_dto(asset)
