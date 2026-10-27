"""Frozen parameter/return schemas for the four core tools.

``*_PARAMS`` / ``*_RETURNS`` are plain dicts copied from Doc 01 §9.2-9.5 and are
the contract Doc 10 compares against byte-for-byte (Doc 08 §15.2).  They are
re-exported here so a test can diff them against ``mcp.list_tools()`` without
importing the tool modules.
"""

from .claim import CLAIM_PARAMS, CLAIM_RETURNS, ClaimNextTaskArgs, ClaimedTaskProjection
from .propose import PROPOSE_PARAMS, PROPOSE_RETURNS, ProposeTaskArgs, ProposeTaskResult
from .progress import PROGRESS_PARAMS, PROGRESS_RETURNS, LogTaskProgressArgs, LogTaskProgressResult
from .submit import SUBMIT_PARAMS, SUBMIT_RETURNS, SubmitForReviewArgs, SubmitForReviewResult

#: core tool name -> (params dict, returns dict)
CORE_CONTRACTS = {
    "claim_next_task": (CLAIM_PARAMS, CLAIM_RETURNS),
    "propose_task": (PROPOSE_PARAMS, PROPOSE_RETURNS),
    "submit_for_review": (SUBMIT_PARAMS, SUBMIT_RETURNS),
    "log_task_progress": (PROGRESS_PARAMS, PROGRESS_RETURNS),
}

__all__ = [
    "CLAIM_PARAMS",
    "CLAIM_RETURNS",
    "CORE_CONTRACTS",
    "ClaimNextTaskArgs",
    "ClaimedTaskProjection",
    "LogTaskProgressArgs",
    "LogTaskProgressResult",
    "PROGRESS_PARAMS",
    "PROGRESS_RETURNS",
    "PROPOSE_PARAMS",
    "PROPOSE_RETURNS",
    "ProposeTaskArgs",
    "ProposeTaskResult",
    "SUBMIT_PARAMS",
    "SUBMIT_RETURNS",
    "SubmitForReviewArgs",
    "SubmitForReviewResult",
]
