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
from core.errors import ValidationError
from core.models import Task
from core.services import tasks as task_service


class DiscoveryListView(AtlasAPIView):
    def get(self, request):
        limit = resolve_page_size(request.query_params.get("limit"))
        slug = request.query_params.get("project_slug")
        # Only live proposals belong in triage. Archive is `REJECTED +
        # archived_at`, so a dismissed-then-archived discovery must not reappear.
        qs = (
            Task.objects.filter(
                status=TaskStatus.PENDING_APPROVAL, archived_at__isnull=True
            )
            .select_related("project")
            .prefetch_related("assets", "checklist")
            .order_by("-created_at")
        )
        if slug:
            qs = qs.filter(project__slug=slug)
        rows = list(qs[:limit])
        return Response(
            {"items": [serialize_discovery(t) for t in rows], "next_cursor": None}
        )


class DiscoveryDetailView(AtlasAPIView):
    """`PATCH /discoveries/{id}/` — correct a proposal before approving it.

    Only the fields a proposal carries are patchable. `status` is excluded on
    purpose: approve/reject/restore own the transitions, so the guard table keeps
    one implementation per move. `dod_items` is accepted because the agent
    sometimes supplies a checklist the operator wants to reword.
    """

    EDITABLE = ("title", "description", "priority", "dod_items", "discovery_reason")

    def patch(self, request, task_id: str):
        payload = body(request)
        unknown = sorted(set(payload) - set(self.EDITABLE))
        if unknown:
            raise ValidationError(
                f"Only {', '.join(self.EDITABLE)} can be patched here.",
                detail={"fields": unknown},
            )
        dod_items = payload.get("dod_items")
        if dod_items is not None and not isinstance(dod_items, list):
            raise ValidationError(
                "dod_items must be an array of strings.", detail={"field": "dod_items"}
            )

        task = task_service.update_discovery(
            task_id=task_id,
            title=payload.get("title"),
            description=payload.get("description"),
            priority=optional_int(payload, "priority"),
            dod_items=dod_items,
            discovery_reason=payload.get("discovery_reason"),
        )
        return Response(serialize_discovery(task))


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


class DiscoveryRestoreView(AtlasAPIView):
    """`POST /discoveries/{id}/restore/` — undo a triage decision.

    The inbox dispatches immediately (§9.5), so "Undo" needs a real inverse
    rather than a cancelled timer.
    """

    def post(self, request, task_id: str):
        task = task_service.restore_discovery(task_id=task_id)
        return Response(serialize_discovery(task))
