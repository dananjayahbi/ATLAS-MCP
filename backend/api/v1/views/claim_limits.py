"""Operator routes for claim-limit requests (Doc 04 §5.x).

The agent can only *ask*: `core.services.claim_limits.request_limit` records the
request and this surface is the only place a ceiling actually moves. Keeping
the two apart is what makes "the AI cannot raise its own limit" a structural
guarantee rather than a convention.
"""

from __future__ import annotations

from rest_framework.response import Response

from api.v1.views.base import AtlasAPIView, body, optional_int, optional_str
from core.services import claim_limits
from core.services.claim_limits import to_dto


class ClaimLimitRequestListView(AtlasAPIView):
    """`GET /claim-limit-requests/` — pending asks, optionally per project."""

    def get(self, request):
        from core.models import Project

        slug = (request.query_params.get("project_slug") or "").strip()
        project = None
        if slug:
            project = Project.objects.filter(slug=slug).first()
            if project is None:
                from core.errors import ProjectNotFound

                raise ProjectNotFound(
                    f"No project with slug '{slug}'.", detail={"slug": slug}
                )
        rows = claim_limits.pending_requests(project)
        return Response(
            {"items": [to_dto(row) for row in rows], "next_cursor": None}
        )


class ClaimLimitRequestResolveView(AtlasAPIView):
    """`POST /claim-limit-requests/{id}/resolve/` with `{"approve": bool}`.

    Approving applies `granted_limit` (defaulting to what the agent asked for) to
    the project. Dismissing leaves the ceiling untouched.
    """

    def post(self, request, request_id: str):
        payload = body(request)
        approve = payload.get("approve", True)
        if not isinstance(approve, bool):
            from core.errors import ValidationError

            raise ValidationError("approve must be a boolean.",
                                  detail={"field": "approve"})
        row = claim_limits.resolve_request(
            request_id=request_id,
            approve=approve,
            actor=optional_str(payload, "actor", "human") or "human",
            note=optional_str(payload, "note", ""),
            granted_limit=optional_int(payload, "granted_limit"),
        )
        return Response(to_dto(row))
