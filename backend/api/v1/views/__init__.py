"""Public API v1 views."""

from api.v1.views.assets import AssetContentView, AssetDetailView, AssetUploadView
from api.v1.views.discoveries import (
    DiscoveryApproveView,
    DiscoveryListView,
    DiscoveryRejectView,
)
from api.v1.views.projects import ProjectDetailView, ProjectListView
from api.v1.views.reviews import (
    ReviewApproveView,
    ReviewListView,
    ReviewRejectView,
)
from api.v1.views.tasks import (
    TaskArchiveView,
    TaskClaimForAgentView,
    TaskDetailView,
    TaskDodView,
    TaskForceReleaseView,
    TaskHistoryView,
    TaskListView,
    TaskPriorityView,
    TaskRequeueView,
)
from api.v1.views.telemetry import PriorityMatrixView, TelemetrySummaryView

__all__ = [name for name in dir() if name.endswith(("View", "Views"))]
