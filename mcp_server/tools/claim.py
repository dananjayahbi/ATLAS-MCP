"""``claim_next_task`` -- ``POST /internal/v1/claim`` (Doc 08 §7.1).

Doubles as the agent's orientation call: repo root, project rules, DoD and
absolute image paths all arrive in one projection.  ``retries=0`` by design --
a replayed claim may lease a *different* task (§12.2), so a transport failure
must reach the agent instead of silently swapping work underneath it.
"""

from __future__ import annotations

import logging
from typing import Any, Callable

from ..client import CLAIM_PATH
from ..projections import project_claimed_task
from ..schemas.claim import CLAIM_PARAMS, ClaimNextTaskArgs, ClaimedTaskProjection
from . import ToolSpec, invoke, payload, publish_frozen

LOGGER = logging.getLogger("atlas.mcp.claim")

NAME = "claim_next_task"
DESCRIPTION = (
    "Claims the highest priority available pending task for a specific project. "
    "Returns a 15-minute completion estimate, not a hard deadline: if the estimate "
    "passes, keep working and call task_heartbeat to re-estimate. A task blocked by "
    "another only becomes claimable once that blocker's Definition of Done reaches 100%."
)


def make_handler(cfg: Any, client: Any) -> Callable[[ClaimNextTaskArgs], dict]:
    """Build ``handler(args: Model) -> dict`` with config and client closed over."""

    def handler(args: ClaimNextTaskArgs) -> dict:
        LOGGER.info(
            "claim project=%s agent=%s min_priority=%s",
            args.project_slug,
            args.agent_identifier,
            args.min_priority,
        )
        raw = client.post(
            CLAIM_PATH,
            {
                "project_slug": args.project_slug,
                "agent_identifier": args.agent_identifier,
                "min_priority": args.min_priority,
            },
            retries=0,
            tool=NAME,
        )
        return project_claimed_task(
            raw,
            lease_ttl_default=cfg.lease_ttl_seconds,
            heartbeat_interval_default=cfg.heartbeat_interval_seconds,
            long_path_prefix=cfg.long_path_prefix,
            storage_root=cfg.storage_root,
        )

    return handler


def register(mcp: Any, cfg: Any, client: Any) -> None:
    handler = make_handler(cfg, client)

    def claim_next_task(
        project_slug: Any,
        agent_identifier: Any,
        min_priority: Any = None,
    ) -> str:
        return invoke(
            ClaimNextTaskArgs,
            payload(
                project_slug=project_slug,
                agent_identifier=agent_identifier,
                min_priority=min_priority,
            ),
            handler,
        )

    mcp.tool(name=NAME, description=DESCRIPTION, structured_output=False)(claim_next_task)
    publish_frozen(mcp, name=NAME, description=DESCRIPTION, params=CLAIM_PARAMS)


__all__ = [
    "DESCRIPTION",
    "NAME",
    "REGISTER",
    "ClaimedTaskProjection",
    "make_handler",
    "register",
]

REGISTER = ToolSpec(name=NAME, description=DESCRIPTION, register=register)
