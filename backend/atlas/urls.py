"""URL root: API v1 + internal agent RPC + health (Doc 01 §12)."""

from __future__ import annotations

from django.http import JsonResponse
from django.urls import include, path
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET


@require_GET
@csrf_exempt
def healthz(request):
    """Unauthenticated liveness probe (Doc 01 §12, Doc 03 §9)."""
    from core.recovery import health_report

    payload = health_report()
    return JsonResponse(payload, status=200 if payload.get("status") == "ok" else 503)


urlpatterns = [
    path("healthz", healthz, name="healthz"),
    path("api/v1/", include("api.v1.urls")),
    path("internal/v1/", include("api.internal.urls")),
]
