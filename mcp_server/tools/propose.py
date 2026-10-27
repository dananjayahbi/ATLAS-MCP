"""``propose_task`` -- ``POST /internal/v1/propose`` (Doc 08 §7.2).

Files an out-of-scope discovery into human triage as ``PENDING_APPROVAL``; it is
never claimable until a human approves it.  Screenshot containment is checked
locally **before** any HTTP call, so an escape costs zero bytes and returns in
microseconds (§9.3, scenario I-7).
"""

from __future__ import annotations

import logging
from typing import Any, Callable

from ..client import PROPOSE_PATH
from ..errors import InvalidArgument
from ..paths import assert_all_within_root
from ..projections import project_propose
from ..schemas.propose import MAX_SCREENSHOTS, PROPOSE_PARAMS, ProposeTaskArgs, ProposeTaskResult
from . import ToolSpec, invoke, payload, publish_frozen

LOGGER = logging.getLogger("atlas.mcp.propose")

NAME = "propose_task"
DESCRIPTION = (
    "Proposes an out-of-scope bug, regression, or technical improvement discovered "
    "while working on an assigned task. Places the item into human triage."
)


def make_handler(cfg: Any, client: Any) -> Callable[[ProposeTaskArgs], dict]:
    def handler(args: ProposeTaskArgs) -> dict:
        # Containment first: zero HTTP calls when a path escapes the storage root.
        screenshots = assert_all_within_root(args.screenshot_paths, cfg.storage_root)

        if not args.title.strip():
            raise InvalidArgument("title: must not be blank")
        if not args.description.strip():
            raise InvalidArgument("description: must not be blank")
        if len(screenshots) > MAX_SCREENSHOTS:
            raise InvalidArgument(
                f"screenshot_paths: at most {MAX_SCREENSHOTS} entries are allowed"
            )

        LOGGER.info(
            "propose project=%s during=%s screenshots=%d",
            args.project_slug,
            args.discovered_during_task_id,
            len(screenshots),
        )
        raw = client.post(
            PROPOSE_PATH,
            {
                "project_slug": args.project_slug,
                "title": args.title,
                "description": args.description,
                "suggested_priority": args.suggested_priority,
                "discovered_during_task_id": args.discovered_during_task_id,
                "screenshot_paths": screenshots,
            },
            retries=2,
            tool=NAME,
        )
        return project_propose(raw)

    return handler


def register(mcp: Any, cfg: Any, client: Any) -> None:
    handler = make_handler(cfg, client)

    def propose_task(
        project_slug: Any,
        title: Any,
        description: Any,
        suggested_priority: Any,
        discovered_during_task_id: Any,
        screenshot_paths: Any = None,
    ) -> str:
        return invoke(
            ProposeTaskArgs,
            payload(
                project_slug=project_slug,
                title=title,
                description=description,
                suggested_priority=suggested_priority,
                discovered_during_task_id=discovered_during_task_id,
                screenshot_paths=screenshot_paths,
            ),
            handler,
        )

    mcp.tool(name=NAME, description=DESCRIPTION, structured_output=False)(propose_task)
    publish_frozen(mcp, name=NAME, description=DESCRIPTION, params=PROPOSE_PARAMS)


__all__ = ["DESCRIPTION", "NAME", "REGISTER", "ProposeTaskResult", "make_handler", "register"]

REGISTER = ToolSpec(name=NAME, description=DESCRIPTION, register=register)
