"""Request-id + auth middleware (Doc 01 §7.8, §14)."""

from __future__ import annotations

import logging

from api.common.auth import is_public_path, require_token
from core.errors import AtlasError
from core.ids import request_id as new_request_id

logger = logging.getLogger("atlas.middleware")


class RequestIdMiddleware:
    """Attach a ULID `request_id` to every request and every response."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        request.request_id = request.headers.get("X-Request-ID") or new_request_id()
        response = self.get_response(request)
        response["X-Request-ID"] = request.request_id
        return response


class ApiAuthMiddleware:
    """Reject unauthenticated `/api/v1` and `/internal/v1` requests early.

    Views still call `require_token` where an explicit check reads better; this
    middleware exists so no future route can be accidentally unauthenticated.
    """

    PROTECTED_PREFIXES = ("/api/v1/", "/internal/v1/")

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        path = request.path_info
        if is_public_path(path) or not path.startswith(self.PROTECTED_PREFIXES):
            return self.get_response(request)

        try:
            require_token(request)
        except AtlasError as exc:
            from django.http import JsonResponse

            return JsonResponse(
                exc.to_envelope(getattr(request, "request_id", None)),
                status=exc.http_status,
            )
        return self.get_response(request)
