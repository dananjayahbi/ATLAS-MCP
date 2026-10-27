"""`ChecklistItemDTO` — wire `id` is `order_index` (Doc 01 §6.5)."""

from __future__ import annotations

from rest_framework import serializers

from core.models import ChecklistItem


class ChecklistItemSerializer(serializers.ModelSerializer):
    id = serializers.IntegerField(source="order_index", read_only=True)

    class Meta:
        model = ChecklistItem
        fields = ["id", "label", "completed", "completed_at"]


def serialize_checklist(item: ChecklistItem) -> dict:
    from api.v1.serializers.computed import iso

    return {
        "id": item.order_index,
        "label": item.label,
        "completed": item.completed,
        "completed_at": iso(item.completed_at),
    }
