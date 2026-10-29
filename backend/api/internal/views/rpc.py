"""`/internal/v1` views — stateless agent RPC (Doc 01 §10, Doc 04 §6)."""

from __future__ import annotations

import hashlib

from django.core.cache import cache
from rest_framework.response import Response

from api.internal import serializers as ser
from api.internal.projections import project_claimed_task, project_task_read
from api.v1.serializers.event import serialize_event
from api.v1.views.base import AtlasAgentView, body
from core import leases
from core.errors import ValidationError
from core.models import Task
from core.services import tasks as task_service


def _validated(serializer_cls, payload, **kwargs):
    serializer = serializer_cls(data=payload, **kwargs)
    if not serializer.is_valid():
        raise ValidationError("Invalid request body.",
                              detail=serializer.errors)
    return serializer.validated_data


class ClaimView(AtlasAgentView):
    def post(self, request):
        data = _validated(ser.ClaimRequest, body(request))
        result = leases.claim_next_task(
            project_slug=data["project_slug"],
            agent_identifier=data["agent_identifier"],
            min_priority=data["min_priority"],
        )
        if isinstance(result, leases.ClaimLimitReached):
            return Response(
                {
                    "task_id": None,
                    "reason": result.reason,
                    "claim_limit": result.limit,
                    "in_progress": result.in_progress,
                    "hint": (
                        "The project's concurrent-claim limit is reached. Finish and "
                        "submit the tasks you already hold, or call request_claim_limit "
                        "to ask the operator for a higher ceiling. Do not retry in a loop."
                    ),
                }
            )
        if isinstance(result, leases.NoEligibleTask):
            return Response({"task_id": None, "reason": result.reason})

        task = (
            Task.objects.select_related("project")
            .prefetch_related("checklist", "assets")
            .get(pk=result.task.pk)
        )
        return Response(project_claimed_task(task))


class HeartbeatView(AtlasAgentView):
    def post(self, request):
        data = _validated(ser.HeartbeatRequest, body(request))
        task, remaining = leases.heartbeat(task_id=data["task_id"], lease=data["lease_id"])
        from core.ids import iso_z

        return Response(
            {
                "ok": True,
                "lease_expires_at": iso_z(task.lease_expires_at),
                "seconds_remaining": remaining,
            }
        )


class ProgressView(AtlasAgentView):
    def post(self, request):
        data = _validated(ser.ProgressRequest, body(request))
        task_service.log_progress(
            task_id=data["task_id"],
            message=data["message"],
            level=data["level"],
            agent_identifier=self.agent(request),
        )
        return Response({"ok": True})


class DodView(AtlasAgentView):
    def post(self, request):
        data = _validated(ser.DodRequest, body(request))
        _, percent = task_service.update_dod_item(
            task_id=data["task_id"],
            item_id=data["item_id"],
            completed=data["completed"],
            agent_identifier=self.agent(request),
        )
        return Response({"ok": True, "dod_progress_percent": percent})


class SubmitView(AtlasAgentView):
    def post(self, request):
        data = _validated(ser.SubmitRequest, body(request))
        patch = data["git_patch"]
        digest = hashlib.sha256(patch.encode("utf-8")).hexdigest()
        idempotency_key = f"submit:{data['task_id']}:{digest}"

        cached = cache.get(idempotency_key)
        if cached is not None:
            return Response(cached)

        task = task_service.submit_for_review(
            task_id=data["task_id"],
            summary_of_work=data["summary_of_work"],
            git_patch=patch,
            verification_log=data.get("verification_log") or None,
            agent_identifier=self.agent(request),
        )
        payload = {
            "ok": True,
            "status": task.status,
            "dod_progress_percent": task.dod_progress_percent,
        }
        cache.set(idempotency_key, payload, timeout=24 * 3600)
        return Response(payload)


class ProposeView(AtlasAgentView):
    def post(self, request):
        data = _validated(ser.ProposeRequest, body(request))
        key = "propose:{}:{}:{}".format(
            data["project_slug"],
            hashlib.sha256(data["title"].encode()).hexdigest()[:16],
            data["discovered_during_task_id"],
        )
        cached = cache.get(key)
        if cached is not None:
            return Response(cached)

        task = task_service.propose_task(
            project_slug=data["project_slug"],
            title=data["title"],
            description=data["description"],
            suggested_priority=data["suggested_priority"],
            discovered_during_task_id=str(data["discovered_during_task_id"]),
            discovered_by_agent=self.agent(request),
            discovery_reason=data.get("discovery_reason") or "",
            screenshot_paths=data.get("screenshot_paths") or [],
        )
        payload = {"ok": True, "task_id": str(task.pk), "status": task.status}
        cache.set(key, payload, timeout=600)
        return Response(payload)


class SubtaskView(AtlasAgentView):
    def post(self, request):
        data = _validated(ser.SubtaskRequest, body(request))
        task = task_service.spawn_subtask(
            parent_task_id=str(data["parent_task_id"]),
            title=data["title"],
            description=data["description"],
            priority=data["priority"],
            actor=self.agent(request),
        )
        return Response({"ok": True, "task_id": str(task.pk)})


class TaskRefView(AtlasAgentView):
    def post(self, request):
        data = _validated(ser.TaskRefRequest, body(request))
        task = task_service.get_task(data["task_id"])
        task = (
            Task.objects.select_related("project")
            .prefetch_related("checklist", "assets")
            .get(pk=task.pk)
        )
        payload = project_task_read(task)
        payload["recent_events"] = [
            serialize_event(e) for e in reversed(list(task.events.order_by("-seq")[:20]))
        ]
        return Response(payload)


class TaskSearchView(AtlasAgentView):
    """`POST /internal/v1/tasks/search` — filter the queue before claiming.

    An agent that pulls the whole board burns its context on unrelated work.
    This route answers "what pending POS-terminal tasks exist?" with a shortlist,
    so `claim_next_task` stays the only way to take work.
    """

    def post(self, request):
        from api.internal.projections_extra import project_search_response
        from core.services import search as search_service

        data = _validated(ser.TaskSearchRequest, body(request))
        project = search_service.get_project_for_search(data["project_slug"])
        rows = search_service.search_tasks(
            project,
            query=data.get("q"),
            statuses=data.get("status"),
            priority_min=data.get("priority_min"),
            priority_max=data.get("priority_max"),
            agent=data.get("agent"),
            blocked_only=data.get("blocked_only", False),
            limit=data.get("limit", 20),
            sort=data.get("sort", "priority"),
        )
        # `total_matched` lets the agent tell "there are 3" from "there are 300,
        # here are 20", which changes whether it narrows the query.
        total = search_service.count_matches(
            project,
            query=data.get("q"),
            statuses=data.get("status"),
            priority_min=data.get("priority_min"),
            priority_max=data.get("priority_max"),
            agent=data.get("agent"),
            blocked_only=data.get("blocked_only", False),
        )
        return Response(
            project_search_response(
                rows,
                project_slug=str(data["project_slug"]),
                total_matched=total,
                limit=data.get("limit", 20),
            )
        )


class ClaimLimitRequestView(AtlasAgentView):
    """`POST /internal/v1/claim-limit` — ask the operator for a higher ceiling.

    Deliberately one-way: creating a request never changes `Project.claim_limit`.
    Only the operator's approve route does that.
    """

    def post(self, request):
        from api.internal.projections_extra import project_claim_request
        from core.services import claim_limits

        data = _validated(ser.ClaimLimitRequestCreate, body(request))
        row = claim_limits.request_limit(
            project_slug=data["project_slug"],
            requested_limit=data["requested_limit"],
            reason=data.get("reason") or "",
            agent_identifier=self.agent(request),
        )
        return Response(project_claim_request(row))
