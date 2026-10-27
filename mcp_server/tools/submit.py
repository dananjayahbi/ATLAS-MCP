"""``submit_for_review`` -- ``POST /internal/v1/submit`` (Doc 08 §7.3).

Hands work back for human sign-off and moves ``IN_PROGRESS -> IN_REVIEW``.  The
5 MB patch cap and the unified-diff marker check are both pre-flighted locally,
so a bad patch fails in microseconds rather than after a 30 s upload (§5.4).
No lease id is sent: ownership is resolved server-side from ``task_id`` +
``X-ATLAS-Agent`` (§7.3).
"""

from __future__ import annotations

import logging
from typing import Any, Callable

from ..client import SUBMIT_PATH
from ..errors import InvalidArgument
from ..projections import project_submit
from ..schemas.submit import (
    PATCH_MAX_CHARS,
    SUBMIT_PARAMS,
    SubmitForReviewArgs,
    SubmitForReviewResult,
)
from . import ToolSpec, invoke, payload, publish_frozen

LOGGER = logging.getLogger("atlas.mcp.submit")

NAME = "submit_for_review"
DESCRIPTION = (
    "Submits a claimed task for human verification with git patch and test run output. "
    "Releases the lease and sets status to IN_REVIEW."
)


def make_handler(cfg: Any, client: Any) -> Callable[[SubmitForReviewArgs], dict]:
    def handler(args: SubmitForReviewArgs) -> dict:
        # Pre-flight: nothing leaves the process when the patch is unusable.
        patch_bytes = len(args.git_patch.encode("utf-8"))
        if patch_bytes > PATCH_MAX_CHARS:
            raise InvalidArgument(
                f"git_patch: {patch_bytes} bytes exceeds the {PATCH_MAX_CHARS}-byte cap; shrink the diff"
            )
        if not args.patch_looks_like_unified_diff():
            raise InvalidArgument(
                "git_patch: must be a unified diff containing '---' and '+++' markers"
            )

        LOGGER.info(
            "submit task=%s patch_bytes=%d log_bytes=%d",
            args.task_id,
            patch_bytes,
            len((args.verification_log or "").encode("utf-8")),
        )
        raw = client.post(
            SUBMIT_PATH,
            {
                "task_id": args.task_id,
                "summary_of_work": args.summary_of_work,
                "git_patch": args.git_patch,
                "verification_log": args.verification_log or "",
            },
            retries=2,
            tool=NAME,
        )
        return project_submit(raw)

    return handler


def register(mcp: Any, cfg: Any, client: Any) -> None:
    handler = make_handler(cfg, client)

    def submit_for_review(
        task_id: Any,
        summary_of_work: Any,
        git_patch: Any,
        verification_log: Any = None,
    ) -> str:
        return invoke(
            SubmitForReviewArgs,
            payload(
                task_id=task_id,
                summary_of_work=summary_of_work,
                git_patch=git_patch,
                verification_log=verification_log,
            ),
            handler,
        )

    mcp.tool(name=NAME, description=DESCRIPTION, structured_output=False)(submit_for_review)
    publish_frozen(mcp, name=NAME, description=DESCRIPTION, params=SUBMIT_PARAMS)


__all__ = ["DESCRIPTION", "NAME", "REGISTER", "SubmitForReviewResult", "make_handler", "register"]

REGISTER = ToolSpec(name=NAME, description=DESCRIPTION, register=register)
