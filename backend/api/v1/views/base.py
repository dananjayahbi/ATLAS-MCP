"""Shared view behaviour: auth, throttling, body parsing (Doc 04 §3)."""

from __future__ import annotations

from typing import Any

from rest_framework.request import Request
from rest_framework.views import APIView

from api.common.auth import require_agent_header, require_token
from api.common.throttle import throttles
from core.errors import ValidationError

SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})


class AtlasAPIView(APIView):
    """Base class for every `/api/v1` route."""

    #: Doc 04 §3.4 default. `assets` overrides to the `upload` family.
    throttle_family = "read"

    def initial(self, request: Request, *args, **kwargs) -> None:
        super().initial(request, *args, **kwargs)
        require_token(request)
        # Doc 04 §3.4 defines a budget for `/api/v1` **GETs** and for uploads
        # only; mutations on the human surface are loopback single-operator and
        # deliberately unthrottled so a bulk action cannot starve itself.
        if self.throttle_family and self._is_throttled(request):
            throttles[self.throttle_family].check(self._throttle_key(request))

    def _is_throttled(self, request: Request) -> bool:
        return self.throttle_family != "read" or request.method in SAFE_METHODS

    def _throttle_key(self, request: Request) -> str:
        return request.headers.get("X-ATLAS-Agent") or "human"


class AtlasAgentView(APIView):
    """Base class for every `/internal/v1` route (Doc 01 §10)."""

    throttle_family = "internal"

    def initial(self, request: Request, *args, **kwargs) -> None:
        super().initial(request, *args, **kwargs)
        require_token(request)
        request.agent_identifier = require_agent_header(request)
        throttles[self.throttle_family].check(request.agent_identifier)

    def agent(self, request: Request) -> str:
        return getattr(request, "agent_identifier", "Agent-Unknown")


def body(request: Request) -> dict[str, Any]:
    """Return the JSON body, tolerating a completely absent body.

    Doc 01 §8 requires body-less POSTs on `reviews/{id}/approve` and
    `tasks/{id}/force-release` to succeed rather than 400.
    """
    if not request.body:
        return {}
    data = request.data
    if hasattr(data, "dict"):
        return data.dict()
    if isinstance(data, dict):
        return data
    raise ValidationError("Body must be a JSON object.", detail={"field": "body"})


def require_field(payload: dict, field: str) -> Any:
    if field not in payload or payload[field] in (None, ""):
        raise ValidationError(f"{field} is required.", detail={"field": field})
    return payload[field]


def optional_str(payload: dict, field: str, default: str = "") -> str:
    value = payload.get(field, default)
    if value is None:
        return default
    if not isinstance(value, str):
        raise ValidationError(f"{field} must be a string.", detail={"field": field})
    return value


def optional_int(payload: dict, field: str, default: int | None = None) -> int | None:
    value = payload.get(field, default)
    if value is None:
        return default
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValidationError(f"{field} must be an integer.", detail={"field": field})
    return value
