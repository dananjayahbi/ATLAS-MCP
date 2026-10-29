"""Typed domain errors mapped 1:1 to the Doc 01 §15 taxonomy."""

from __future__ import annotations

from typing import Any

from core.enums import HTTP_STATUS_FOR_CODE, ErrorCode


class AtlasError(Exception):
    """Base class: carries a frozen error code and a JSON-safe detail map."""

    code: str = ErrorCode.INTERNAL_ERROR
    retryable: bool = False

    def __init__(
        self,
        message: str,
        *,
        detail: dict[str, Any] | None = None,
        code: str | None = None,
        retryable: bool | None = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.detail = detail
        self.headers = headers or {}
        if code is not None:
            self.code = code
        if retryable is not None:
            self.retryable = retryable

    @property
    def http_status(self) -> int:
        return HTTP_STATUS_FOR_CODE.get(self.code, 500)

    def to_envelope(self, request_id: str | None = None) -> dict[str, Any]:
        return {
            "error": {
                "code": self.code,
                "message": self.message,
                "retryable": self.retryable,
                "detail": self.detail,
                "request_id": request_id,
            }
        }


class ValidationError(AtlasError):
    code = ErrorCode.VALIDATION_ERROR


class PathOutOfScope(AtlasError):
    code = ErrorCode.PATH_OUT_OF_SCOPE


class AuthError(AtlasError):
    code = ErrorCode.AUTH_MISSING


class AuthInvalid(AtlasError):
    code = ErrorCode.AUTH_INVALID


class ProjectNotFound(AtlasError):
    code = ErrorCode.PROJECT_NOT_FOUND


class TaskNotFound(AtlasError):
    code = ErrorCode.TASK_NOT_FOUND


class AssetNotFound(AtlasError):
    code = ErrorCode.ASSET_NOT_FOUND


class InvalidTransition(AtlasError):
    code = ErrorCode.INVALID_TRANSITION

    def __init__(self, from_status: str, action: str, message: str | None = None) -> None:
        super().__init__(
            message or f"Cannot perform '{action}' from status {from_status}.",
            detail={"from": from_status, "action": action},
        )
        self.from_status = from_status
        self.action = action


class TaskAlreadyLeased(AtlasError):
    code = ErrorCode.TASK_ALREADY_LEASED


class StaleLease(AtlasError):
    code = ErrorCode.STALE_LEASE


class DependencyCycle(AtlasError):
    code = ErrorCode.DEPENDENCY_CYCLE


class DependencyUnsatisfiable(AtlasError):
    code = ErrorCode.DEPENDENCY_UNSATISFIABLE


class ClaimLimitReached(AtlasError):
    """The project's concurrent-claim ceiling is full.

    Distinct from `NO_ELIGIBLE_TASK`: eligible work exists, the agent is simply
    not allowed to hold more of it. The agent's remedy is `request_claim_limit`,
    never a retry loop.
    """

    code = ErrorCode.CLAIM_LIMIT_REACHED

    def __init__(self, message: str, *, detail: dict[str, Any] | None = None) -> None:
        super().__init__(message, detail=detail)


class ReviewPreconditionFailed(AtlasError):
    """`submit_for_review` was called without the evidence it requires."""

    code = ErrorCode.REVIEW_PRECONDITION_FAILED


class PayloadTooLarge(AtlasError):
    code = ErrorCode.PAYLOAD_TOO_LARGE


class UnsupportedMediaType(AtlasError):
    code = ErrorCode.UNSUPPORTED_MEDIA_TYPE


class RateLimited(AtlasError):
    code = ErrorCode.RATE_LIMITED
    retryable = True

    def __init__(self, message: str = "Too many requests; retry shortly.", **kwargs) -> None:
        kwargs.setdefault("retryable", True)
        super().__init__(message, **kwargs)


class StorageWriteFailed(AtlasError):
    code = ErrorCode.STORAGE_WRITE_FAILED
    retryable = True


class BackendUnavailable(AtlasError):
    code = ErrorCode.BACKEND_UNAVAILABLE
    retryable = True
