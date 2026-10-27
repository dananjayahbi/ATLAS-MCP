"""Review gate routes (Doc 04 §5.7).

Both approve and reject must accept an **absent body** (Doc 01 §8).
"""

from __future__ import annotations

from rest_framework.response import Response

from api.common.pagination import resolve_page_size
from api.v1.serializers.task import serialize_task_detail
from api.v1.views.base import AtlasAPIView, body, optional_str
from core.enums import TaskStatus
from core.models import Task
from core.services import tasks as task_service


class ReviewListView(AtlasAPIView):
    def get(self, request):
        limit = resolve_page_size(request.query_params.get("limit"))
        slug = request.query_params.get("project_slug")
        qs = (
            Task.objects.filter(status=TaskStatus.IN_REVIEW)
            .select_related("project")
            .prefetch_related("checklist", "assets", "blocked_by", "blocks", "children")
            .order_by("submitted_at")
        )
        if slug:
            qs = qs.filter(project__slug=slug)
        rows = list(qs[:limit])
        return Response(
            {"items": [serialize_task_detail(t) for t in rows], "next_cursor": None}
        )


class ReviewApproveView(AtlasAPIView):
    def post(self, request, task_id: str):
        payload = body(request)
        task = task_service.approve_review(
            task_id=task_id, note=optional_str(payload, "note", "")
        )
        return Response(serialize_task_detail(task))


class ReviewRejectView(AtlasAPIView):
    def post(self, request, task_id: str):
        payload = body(request)
        task = task_service.reject_review(
            task_id=task_id, note=optional_str(payload, "note", "")
        )
        return Response(serialize_task_detail(task))
