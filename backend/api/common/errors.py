"""Error envelope rendering (Doc 01 §7.8).

One exception handler converts every `AtlasError` into the frozen envelope;
DRF's own validation errors are normalised into `VALIDATION_ERROR` with a
field detail map.
"""

from __future__ import annotations

import logging
from typing import Any

from django.http import JsonResponse
from rest_framework import status
from rest_framework.exceptions import ValidationError as DrfValidationError
from rest_framework.response import Response
from rest_framework.views import exception_handler as drf_exception_handler

from core.enums import ErrorCode
from core.errors import AtlasError, ValidationError

logger = logging.getLogger("atlas.errors")


def _request_id(request) -> str | None:
    return getattr(request, "request_id", None) or request.headers.get("X-Request-ID")


def atlas_exception_handler(exc, context) -> Response | None:
    request = context.get("request")

    if isinstance(exc, AtlasError):
        return Response(
            exc.to_envelope(_request_id(request)),
            status=exc.http_status,
            headers=exc.headers or None,
        )

    if isinstance(exc, DrfValidationError):
        detail = getattr(exc, "detail", None)
        normalised = ValidationError(
            "Request validation failed.",
            detail=_flatten_detail(detail),
        )
        return Response(
            normalised.to_envelope(_request_id(request)),
            status=status.HTTP_400_BAD_REQUEST,
        )

    response = drf_exception_handler(exc, context)
    if response is not None:
        code = _code_for_status(response.status_code)
        payload = AtlasError(
            _message_for(response.data), code=code, detail=_flatten_detail(response.data)
        )
        response.data = payload.to_envelope(_request_id(request))
        return response

    logger.exception("Unhandled exception", exc_info=exc)
    payload = AtlasError("Internal server error.", code=ErrorCode.INTERNAL_ERROR)
    return Response(payload.to_envelope(_request_id(request)), status=500)


def envelope_response(
    exc: AtlasError, request=None, *, headers: dict[str, str] | None = None
) -> JsonResponse:
    """For non-DRF views (SSE, health) that must emit the same envelope."""
    return JsonResponse(
        exc.to_envelope(_request_id(request)),
        status=exc.http_status,
        headers=headers,
    )


def _flatten_detail(detail: Any) -> Any:
    if detail is None:
        return None
    if isinstance(detail, dict):
        return {str(k): _flatten_detail(v) for k, v in detail.items()}
    if isinstance(detail, (list, tuple)):
        return [_flatten_detail(v) for v in detail]
    return str(detail)


def _message_for(data: Any) -> str:
    if isinstance(data, dict):
        if "detail" in data:
            return str(data["detail"])
        for value in data.values():
            return _message_for(value)
    if isinstance(data, (list, tuple)) and data:
        return _message_for(data[0])
    return str(data) if data else "Request failed."


def _code_for_status(code: int) -> str:
    mapping = {
        400: ErrorCode.VALIDATION_ERROR,
        401: ErrorCode.AUTH_INVALID,
        403: ErrorCode.AUTH_INVALID,
        404: ErrorCode.TASK_NOT_FOUND,
        409: ErrorCode.INVALID_TRANSITION,
        413: ErrorCode.PAYLOAD_TOO_LARGE,
        415: ErrorCode.UNSUPPORTED_MEDIA_TYPE,
        429: ErrorCode.VALIDATION_ERROR,
        507: ErrorCode.STORAGE_WRITE_FAILED,
    }
    return mapping.get(code, ErrorCode.INTERNAL_ERROR)
