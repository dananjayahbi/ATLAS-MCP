"""`PriorityMatrixPointDTO`, `TelemetrySummaryDTO`, `ProjectDTO.counters` (Doc 01 §7.7)."""

from __future__ import annotations

from rest_framework import serializers


class PriorityMatrixPointSerializer(serializers.Serializer):
    task_id = serializers.CharField()
    title = serializers.CharField()
    project_slug = serializers.CharField()
    status = serializers.CharField()
    priority = serializers.IntegerField()
    age_hours = serializers.FloatField()
    dependency_weight = serializers.FloatField()
    is_blocked = serializers.BooleanField()
    is_agent_discovered = serializers.BooleanField()
    dod_progress_percent = serializers.IntegerField()


class PriorityMatrixSerializer(serializers.Serializer):
    points = PriorityMatrixPointSerializer(many=True)
    axes = serializers.DictField()


class TelemetryProjectSerializer(serializers.Serializer):
    slug = serializers.CharField()
    health_percent = serializers.IntegerField()
    active_agent_id = serializers.CharField(allow_null=True)
    in_progress = serializers.IntegerField()


class TelemetrySummarySerializer(serializers.Serializer):
    projects = TelemetryProjectSerializer(many=True)
    tasks_by_status = serializers.DictField(child=serializers.IntegerField())
    discoveries_pending = serializers.IntegerField()
    oldest_pending_age_hours = serializers.FloatField()
    leases_expiring_within_5m = serializers.IntegerField()
    throughput_last_24h = serializers.IntegerField()
    generated_at = serializers.CharField()


class ProjectCountersSerializer(serializers.Serializer):
    pending = serializers.IntegerField()
    in_progress = serializers.IntegerField()
    in_review = serializers.IntegerField()
    completed = serializers.IntegerField()
    pending_approval = serializers.IntegerField()
    health_percent = serializers.IntegerField()


def serialize_matrix(payload: dict) -> dict:
    return PriorityMatrixSerializer(payload).data


def serialize_telemetry(payload: dict) -> dict:
    return TelemetrySummarySerializer(payload).data


def serialize_project_counters(payload: dict) -> dict:
    return ProjectCountersSerializer(payload).data
