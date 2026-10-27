"""Telemetry & priority-matrix routes (Doc 04 §5.9)."""

from __future__ import annotations

from rest_framework.response import Response

from api.v1.views.base import AtlasAPIView
from core.services.telemetry import priority_matrix, telemetry_summary


class TelemetrySummaryView(AtlasAPIView):
    def get(self, request):
        return Response(telemetry_summary())


class PriorityMatrixView(AtlasAPIView):
    def get(self, request):
        x_axis = request.query_params.get("x", "age_hours")
        if x_axis not in {"age_hours", "dependency_weight"}:
            x_axis = "age_hours"
        payload = priority_matrix(project_slug=request.query_params.get("project_slug"))
        payload["axes"]["x"] = x_axis
        return Response(payload)
