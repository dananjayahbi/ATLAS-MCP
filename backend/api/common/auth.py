"""Bearer-token auth + `/internal/v1` agent header enforcement (Doc 01 §14).

The browser never holds the token: the Next.js server-side rewrite injects it.
`/internal/v1/*` additionally requires `X-ATLAS-Agent`.
"""

from __future__ import annotations

import hmac
import logging
import re

from django.conf import settings
from django.http import HttpRequest

from core.errors import AuthError, AuthInvalid

logger = logging.getLogger("atlas.auth")

_BEARER = re.compile(r"^Bearer\s+(?P<token>.+)$", re.IGNORECASE)
PUBLIC_PREFIXES = ("/healthz",)


def extract_token(request: HttpRequest) -> str | None:
    header = request.headers.get("Authorization") or ""
    match = _BEARER.match(header.strip())
    return match.group("token").strip() if match else None


def tokens_match(provided: str, expected: str) -> bool:
    return hmac.compare_digest(provided.encode("utf-8"), expected.encode("utf-8"))


def require_token(request: HttpRequest) -> None:
    """Raise `AuthError`/`AuthInvalid` unless the request carries a good token.

    There is no bypass: every `/api/v1` and `/internal/v1` route is
    authenticated, in dev and prod alike (Doc 01 §14.2).
    """
    expected = getattr(settings, "ATLAS_API_TOKEN", "") or ""
    if not expected:
        raise AuthError("Server has no ATLAS_API_TOKEN configured.")

    provided = extract_token(request)
    if not provided:
        raise AuthError("Authorization: Bearer <token> is required.")
    if not tokens_match(provided, expected):
        raise AuthInvalid("API token rejected.")


def require_agent_header(request: HttpRequest) -> str:
    agent = (request.headers.get("X-ATLAS-Agent") or "").strip()
    if not agent:
        raise AuthError("X-ATLAS-Agent header is required on /internal/v1 routes.")
    if len(agent) > 120:
        raise AuthInvalid("X-ATLAS-Agent must be ≤120 characters.")
    return agent


def is_public_path(path: str) -> bool:
    return any(path.startswith(prefix) for prefix in PUBLIC_PREFIXES)
