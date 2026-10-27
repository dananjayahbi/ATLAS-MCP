"""Discovery triage routes (Doc 04 §5.6).

Doc 04 §3.4 defines exactly three throttle families — `internal`, `upload`,
`read` — so triage inherits the `read` budget from `AtlasAPIView` rather than
inventing a fourth scope. Mutations on the human surface are unthrottled by
design (see `api/v1/views/base.py`).
"""

from __future__ import annotations

from rest_framework.response import Response

from api.common.pagination import resolve_page_size
from api.v1.serializers.discovery import serialize_discovery
from api.v1.views.base import AtlasAPIView, body, optional_int, optional_str
from core.enums import TaskStatus
from core.models import Task
from core.services import tasks as task_service


class DiscoveryListView(AtlasAPIView):
    def get(self, request):
        limit = resolve_page_size(request.query_params.get("limit"))
        slug = request.query_params.get("project_slug")
        qs = (
            Task.objects.filter(status=TaskStatus.PENDING_APPROVAL)
            .select_related("project")
            .prefetch_related("assets")
            .order_by("-created_at")
        )
        if slug:
            qs = qs.filter(project__slug=slug)
        rows = list(qs[:limit])
        return Response(
            {"items": [serialize_discovery(t) for t in rows], "next_cursor": None}
        )


class DiscoveryApproveView(AtlasAPIView):
    def post(self, request, task_id: str):
        payload = body(request)
        priority = optional_int(payload, "priority")
        task = task_service.approve_discovery(task_id=task_id, priority=priority)
        return Response(serialize_discovery(task))


class DiscoveryRejectView(AtlasAPIView):
    def post(self, request, task_id: str):
        payload = body(request)
        # Doc 04 §5.6 names the field `reason`; `note` is accepted as an alias
        # because the triage shelf shipped with it first.
        note = optional_str(payload, "reason", optional_str(payload, "note", ""))
        task = task_service.reject_discovery(task_id=task_id, note=note)
        return Response(serialize_discovery(task))
