"""Internal RPC serializers (Doc 01 §10)."""

from __future__ import annotations

from rest_framework import serializers


class StatusListField(serializers.Field):
    """Accepts `["PENDING","IN_REVIEW"]` or `"PENDING,IN_REVIEW"`.

    Agents speak JSON arrays; query-style callers use one CSV string. Validating
    the values is `core.services.search.parse_statuses`' job, so both shapes are
    normalised to a list here and the service reports the unknown values.
    """

    def to_internal_value(self, data):
        if data is None:
            return []
        if isinstance(data, str):
            return [part.strip() for part in data.split(",") if part.strip()]
        if isinstance(data, (list, tuple)):
            values: list[str] = []
            for entry in data:
                if not isinstance(entry, str):
                    raise serializers.ValidationError("status entries must be strings.")
                values.extend(part.strip() for part in entry.split(",") if part.strip())
            return values
        raise serializers.ValidationError("status must be a string or an array of strings.")

    def to_representation(self, value):  # pragma: no cover - read-only surface
        return list(value or [])


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


class TaskSearchRequest(serializers.Serializer):
    project_slug = serializers.CharField(max_length=32)
    q = serializers.CharField(max_length=200, required=False, allow_blank=True, default="")
    status = StatusListField(required=False, default=list)
    priority_min = serializers.IntegerField(min_value=0, max_value=100, required=False, allow_null=True, default=None)
    priority_max = serializers.IntegerField(min_value=0, max_value=100, required=False, allow_null=True, default=None)
    agent = serializers.CharField(max_length=120, required=False, allow_blank=True, default="")
    blocked_only = serializers.BooleanField(required=False, default=False)
    limit = serializers.IntegerField(min_value=1, max_value=100, required=False, default=20)
    sort = serializers.ChoiceField(
        choices=["priority", "created", "updated"], required=False, default="priority"
    )


class ClaimLimitRequestCreate(serializers.Serializer):
    project_slug = serializers.CharField(max_length=32)
    requested_limit = serializers.IntegerField(min_value=1, max_value=50)
    reason = serializers.CharField(max_length=4000, required=False, allow_blank=True, default="")
