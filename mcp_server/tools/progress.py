"""``log_task_progress`` -- ``POST /internal/v1/progress`` (Doc 08 §7.4).

The simplest tool in the protocol and the one that proves register -> client ->
project: the response is exactly ``{"ok":true}``, two keys, no envelope.  Any
richer body would be a permanent token tax on the most frequently called tool
(§7.4).
"""

from __future__ import annotations

import logging
from typing import Any, Callable

from ..client import PROGRESS_PATH
from ..projections import project_progress
from ..schemas.progress import PROGRESS_PARAMS, LogTaskProgressArgs, LogTaskProgressResult
from . import ToolSpec, invoke, payload, publish_frozen

LOGGER = logging.getLogger("atlas.mcp.progress")

NAME = "log_task_progress"
DESCRIPTION = (
    "Streams execution progress events to the live HUD terminal via SSE without "
    "consuming agent context memory."
)


def make_handler(cfg: Any, client: Any) -> Callable[[LogTaskProgressArgs], dict]:
    def handler(args: LogTaskProgressArgs) -> dict:
        client.post(
            PROGRESS_PATH,
            {"task_id": args.task_id, "message": args.message, "level": args.level},
            retries=2,
            tool=NAME,
        )
        # The backend body is deliberately discarded: the acknowledgement is not history.
        return project_progress(None)

    return handler


def register(mcp: Any, cfg: Any, client: Any) -> None:
    handler = make_handler(cfg, client)

    def log_task_progress(task_id: Any, message: Any, level: Any = None) -> str:
        return invoke(
            LogTaskProgressArgs,
            payload(task_id=task_id, message=message, level=level),
            handler,
        )

    mcp.tool(name=NAME, description=DESCRIPTION, structured_output=False)(log_task_progress)
    publish_frozen(mcp, name=NAME, description=DESCRIPTION, params=PROGRESS_PARAMS)


__all__ = ["DESCRIPTION", "NAME", "REGISTER", "LogTaskProgressResult", "make_handler", "register"]

REGISTER = ToolSpec(name=NAME, description=DESCRIPTION, register=register)
