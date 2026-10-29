"""``request_claim_limit`` -- ``POST /internal/v1/claim-limit``.

`claim_next_task` can come back with ``reason: "CLAIM_LIMIT_REACHED"`` when the
operator's per-project ceiling is spent. The agent's only correct response is to
ask, once, and then go back to finishing what it holds — never to retry the
claim in a loop. This tool is that ask.

It cannot raise the limit: the backend records a request and waits for a human.
"""

from __future__ import annotations

import logging
from typing import Annotated, Any, Callable

from pydantic import BaseModel, ConfigDict, Field

from ..client import CLAIM_LIMIT_PATH
from ..projections import project_claim_limit
from . import ToolSpec, invoke, payload, publish_frozen

LOGGER = logging.getLogger("atlas.mcp.claim_limit")

NAME = "request_claim_limit"
DESCRIPTION = (
    "Asks the operator to raise this project's concurrent-claim limit. You cannot change "
    "the limit yourself; submit the tasks you already hold while the request is pending."
)

#: Mirrors `core.services.claim_limits.MAX_CLAIM_LIMIT`.
MAX_REQUESTABLE = 50

REQUEST_PARAMS: dict = {
    "type": "object",
    "required": ["project_slug", "requested_limit", "reason"],
    "properties": {
        "project_slug": {"type": "string"},
        "requested_limit": {
            "type": "integer",
            "minimum": 1,
            "maximum": MAX_REQUESTABLE,
            "description": "The ceiling you are asking for; must exceed the current one",
        },
        "reason": {
            "type": "string",
            "maxLength": 4000,
            "description": "Why the current limit blocks the work you can see",
        },
    },
}

REQUEST_RETURNS: dict = {
    "type": "object",
    "required": ["ok", "request_id", "status"],
    "properties": {
        "ok": {"type": "boolean"},
        "request_id": {"type": "string"},
        "status": {"type": "string", "enum": ["PENDING", "APPROVED", "DISMISSED"]},
        "current_limit": {"type": "integer"},
        "requested_limit": {"type": "integer"},
        "note": {"type": "string"},
    },
}


class RequestClaimLimitArgs(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, frozen=True)

    project_slug: Annotated[
        str,
        Field(
            min_length=2,
            max_length=32,
            pattern=r"^[a-z][a-z0-9-]{1,31}$",
            description="Project slug, e.g. 'alpha'",
        ),
    ]
    requested_limit: Annotated[int, Field(ge=1, le=MAX_REQUESTABLE)]
    reason: Annotated[str, Field(min_length=1, max_length=4000)]


def make_handler(cfg: Any, client: Any) -> Callable[[RequestClaimLimitArgs], dict]:
    def handler(args: RequestClaimLimitArgs) -> dict:
        LOGGER.info(
            "claim-limit request project=%s requested=%d",
            args.project_slug,
            args.requested_limit,
        )
        raw = client.post(
            CLAIM_LIMIT_PATH,
            {
                "project_slug": args.project_slug,
                "requested_limit": args.requested_limit,
                "reason": args.reason,
            },
            retries=2,
            tool=NAME,
        )
        return project_claim_limit(raw)

    return handler


def register(mcp: Any, cfg: Any, client: Any) -> None:
    handler = make_handler(cfg, client)

    def request_claim_limit(
        project_slug: Any,
        requested_limit: Any,
        reason: Any,
    ) -> str:
        return invoke(
            RequestClaimLimitArgs,
            payload(
                project_slug=project_slug,
                requested_limit=requested_limit,
                reason=reason,
            ),
            handler,
        )

    mcp.tool(name=NAME, description=DESCRIPTION, structured_output=False)(request_claim_limit)
    publish_frozen(mcp, name=NAME, description=DESCRIPTION, params=REQUEST_PARAMS)


__all__ = [
    "DESCRIPTION",
    "MAX_REQUESTABLE",
    "NAME",
    "REGISTER",
    "REQUEST_PARAMS",
    "REQUEST_RETURNS",
    "RequestClaimLimitArgs",
    "make_handler",
    "register",
]

REGISTER = ToolSpec(name=NAME, description=DESCRIPTION, register=register)
