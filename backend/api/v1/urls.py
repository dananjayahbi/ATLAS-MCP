"""`/api/v1` route table (Doc 01 §12, Doc 04 §2.1)."""

from __future__ import annotations

from django.urls import path

from api.v1.views import assets, claim_limits, discoveries, projects, reviews, tasks, telemetry

urlpatterns = [
    # Projects
    path("projects/", projects.ProjectListView.as_view(), name="project-list"),
    path("projects/<slug:slug>/", projects.ProjectDetailView.as_view(), name="project-detail"),
    # Tasks
    path("projects/<slug:slug>/tasks/", tasks.TaskListView.as_view(), name="task-list"),
    path(
        "projects/<slug:slug>/archive/",
        projects.ProjectArchiveView.as_view(),
        name="project-archive",
    ),
    path("tasks/<uuid:task_id>/", tasks.TaskDetailView.as_view(), name="task-detail"),
    path("tasks/<uuid:task_id>/status/", tasks.TaskStatusView.as_view(), name="task-status"),
    path(
        "tasks/<uuid:task_id>/assignee/",
        tasks.TaskAssigneeView.as_view(),
        name="task-assignee",
    ),
    path("tasks/<uuid:task_id>/priority/", tasks.TaskPriorityView.as_view(), name="task-priority"),
    path(
        "tasks/<uuid:task_id>/dod/<int:item_id>/",
        tasks.TaskDodView.as_view(),
        name="task-dod",
    ),
    path(
        "tasks/<uuid:task_id>/force-release/",
        tasks.TaskForceReleaseView.as_view(),
        name="task-force-release",
    ),
    path("tasks/<uuid:task_id>/archive/", tasks.TaskArchiveView.as_view(), name="task-archive"),
    path("tasks/<uuid:task_id>/requeue/", tasks.TaskRequeueView.as_view(), name="task-requeue"),
    path(
        "tasks/<uuid:task_id>/claim-for-agent/",
        tasks.TaskClaimForAgentView.as_view(),
        name="task-claim-for-agent",
    ),
    path("tasks/<uuid:task_id>/events/", tasks.TaskHistoryView.as_view(), name="task-events"),
    # Discoveries
    path("discoveries/", discoveries.DiscoveryListView.as_view(), name="discovery-list"),    path(
        "discoveries/<uuid:task_id>/",
        discoveries.DiscoveryDetailView.as_view(),
        name="discovery-detail",
    ),
    path(
        "discoveries/<uuid:task_id>/approve/",
        discoveries.DiscoveryApproveView.as_view(),
        name="discovery-approve",
    ),
    path(
        "discoveries/<uuid:task_id>/reject/",
        discoveries.DiscoveryRejectView.as_view(),
        name="discovery-reject",
    ),
    path(
        "discoveries/<uuid:task_id>/restore/",
        discoveries.DiscoveryRestoreView.as_view(),
        name="discovery-restore",
    ),
    # Reviews
    path("reviews/", reviews.ReviewListView.as_view(), name="review-list"),
    path(
        "reviews/<uuid:task_id>/approve/",
        reviews.ReviewApproveView.as_view(),
        name="review-approve",
    ),
    path(
        "reviews/<uuid:task_id>/reject/",
        reviews.ReviewRejectView.as_view(),
        name="review-reject",
    ),
    # Claim-limit requests (operator-only resolution; agents can only ask)
    path(
        "claim-limit-requests/",
        claim_limits.ClaimLimitRequestListView.as_view(),
        name="claim-limit-request-list",
    ),
    path(
        "claim-limit-requests/<uuid:request_id>/resolve/",
        claim_limits.ClaimLimitRequestResolveView.as_view(),
        name="claim-limit-request-resolve",
    ),
    # Assets
    path("assets/", assets.AssetUploadView.as_view(), name="asset-upload"),
    path(
        "projects/<slug:slug>/assets/",
        assets.ProjectAssetPreviewView.as_view(),
        name="project-asset-preview",
    ),
    path("assets/<uuid:asset_id>/", assets.AssetDetailView.as_view(), name="asset-detail"),
    path(
        "assets/<uuid:asset_id>/annotation/",
        assets.AssetAnnotationView.as_view(),
        name="asset-annotation",
    ),
    path(
        "assets/<uuid:asset_id>/content",
        assets.AssetContentView.as_view(),
        name="asset-content",
    ),
    path(
        "assets/<uuid:asset_id>/thumbnail",
        assets.AssetThumbnailView.as_view(),
        name="asset-thumbnail",
    ),
    path(
        "assets/<uuid:asset_id>/download",
        assets.AssetContentView.as_view(),
        name="asset-download",
    ),
    # Telemetry
    path(
        "telemetry/summary",
        telemetry.TelemetrySummaryView.as_view(),
        name="telemetry-summary",
    ),
    path(
        "priority-matrix",
        telemetry.PriorityMatrixView.as_view(),
        name="priority-matrix",
    ),
    # SSE
    path("stream/events", __import__("api.sse", fromlist=["events_stream"]).events_stream,
         name="stream-events"),
    path("stream/tasks/<uuid:task_id>/log",
         __import__("api.sse", fromlist=["task_log_stream"]).task_log_stream,
         name="stream-task-log"),
]
