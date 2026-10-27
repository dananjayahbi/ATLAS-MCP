"""Serializers mapped 1:1 to the frozen DTOs of Doc 01 §7 (Doc 04 §4)."""

from api.v1.serializers.asset import AssetSerializer, serialize_asset
from api.v1.serializers.checklist import ChecklistItemSerializer, serialize_checklist
from api.v1.serializers.discovery import DiscoverySerializer, serialize_discovery
from api.v1.serializers.project import ProjectSerializer, serialize_project
from api.v1.serializers.task import (
    TaskDetailSerializer,
    TaskSummarySerializer,
    serialize_task_detail,
    serialize_task_summary,
)
from api.v1.serializers.telemetry import (
    PriorityMatrixSerializer,
    TelemetrySummarySerializer,
    serialize_matrix,
    serialize_project_counters,
    serialize_telemetry,
)

__all__ = [
    "AssetSerializer",
    "serialize_asset",
    "ChecklistItemSerializer",
    "serialize_checklist",
    "DiscoverySerializer",
    "serialize_discovery",
    "ProjectSerializer",
    "serialize_project",
    "TaskDetailSerializer",
    "TaskSummarySerializer",
    "serialize_task_detail",
    "serialize_task_summary",
    "PriorityMatrixSerializer",
    "TelemetrySummarySerializer",
    "serialize_matrix",
    "serialize_project_counters",
    "serialize_telemetry",
]
