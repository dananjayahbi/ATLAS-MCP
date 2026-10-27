"""Internal RPC route table (Doc 01 §10)."""

from __future__ import annotations

from django.urls import path

from api.internal.views import rpc

urlpatterns = [
    path("claim", rpc.ClaimView.as_view(), name="internal-claim"),
    path("heartbeat", rpc.HeartbeatView.as_view(), name="internal-heartbeat"),
    path("progress", rpc.ProgressView.as_view(), name="internal-progress"),
    path("dod", rpc.DodView.as_view(), name="internal-dod"),
    path("submit", rpc.SubmitView.as_view(), name="internal-submit"),
    path("propose", rpc.ProposeView.as_view(), name="internal-propose"),
    path("subtask", rpc.SubtaskView.as_view(), name="internal-subtask"),
    path("task", rpc.TaskRefView.as_view(), name="internal-task"),
]
