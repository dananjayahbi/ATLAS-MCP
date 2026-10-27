"""Internal RPC serializers (Doc 01 §10)."""

from __future__ import annotations

from rest_framework import serializers


class ClaimRequest(serializers.Serializer):
    project_slug = serializers.CharField(max_length=32)
    agent_identifier = serializers.CharField(max_length=120)
    min_priority = serializers.IntegerField(min_value=0, max_value=100, default=0)


class HeartbeatRequest(serializers.Serializer):
    task_id = serializers.UUIDField()
    lease_id = serializers.CharField(max_length=32)


class ProgressRequest(serializers.Serializer):
    task_id = serializers.UUIDField()
    message = serializers.CharField(max_length=8000)
    level = serializers.ChoiceField(choices=["DEBUG", "INFO", "WARN", "ERROR"], default="INFO")


class DodRequest(serializers.Serializer):
    task_id = serializers.UUIDField()
    item_id = serializers.IntegerField(min_value=1)
    completed = serializers.BooleanField()


class SubmitRequest(serializers.Serializer):
    task_id = serializers.UUIDField()
    summary_of_work = serializers.CharField(max_length=20000)
    git_patch = serializers.CharField()
    verification_log = serializers.CharField(required=False, allow_blank=True, default="")


class ProposeRequest(serializers.Serializer):
    project_slug = serializers.CharField(max_length=32)
    title = serializers.CharField(max_length=200)
    description = serializers.CharField(max_length=20000)
    suggested_priority = serializers.IntegerField(min_value=0, max_value=100)
    discovered_during_task_id = serializers.UUIDField()
    screenshot_paths = serializers.ListField(
        child=serializers.CharField(max_length=1024), required=False, default=list
    )
    discovery_reason = serializers.CharField(required=False, allow_blank=True, default="")


class SubtaskRequest(serializers.Serializer):
    parent_task_id = serializers.UUIDField()
    title = serializers.CharField(max_length=200)
    description = serializers.CharField(max_length=20000)
    priority = serializers.IntegerField(min_value=0, max_value=100, default=50)


class TaskRefRequest(serializers.Serializer):
    task_id = serializers.UUIDField()
