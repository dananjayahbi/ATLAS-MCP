"""Native-path normalisation and storage-root containment (Doc 08 §9).

This module formats path strings Django already produced and answers one
question about paths the *agent* supplies: is it inside ``ATLAS_STORAGE_ROOT``?
It never composes storage paths (P2 -- ``StorageRouter.to_absolute`` is the sole
composer) and performs no I/O on the output path (N5).
"""

from __future__ import annotations

import os
from pathlib import Path

from .errors import PathOutOfScope

_IS_WINDOWS = os.name == "nt"


def normalize_path(raw: str | None, *, long_prefix: bool = False) -> str:
    """Return a native-absolute path string.

    * N1: absolute paths only; a relative input is returned as-is because the
      caller (Django) is authoritative and re-interpreting it would invent a cwd.
    * N2: native separators via ``str(Path(...))``, never ``str.replace``.
    * N5: no ``resolve()`` -- that hits the filesystem and can stall on a
      missing folder or network drive.
    * N7: the ``\\\\?\\`` prefix is opt-in only.
    """
    if not raw:
        return ""
    text = str(raw)
    try:
        formatted = str(Path(text).expanduser())
    except (OSError, ValueError):  # pragma: no cover - malformed input
        return text
    if long_prefix and _IS_WINDOWS and formatted and not formatted.startswith("\\\\?\\"):
        if not formatted.startswith("\\\\"):
            return f"\\\\?\\{formatted}"
    return formatted


def to_posix_relative(raw: str | None) -> str:
    """Convert a native path to POSIX-relative form (DB storage convention)."""
    if not raw:
        return ""
    return str(Path(raw)).replace(os.sep, "/")


def is_within_root(candidate: str, root: str) -> bool:
    """True when ``candidate`` resolves inside ``root``.

    ``strict=False`` keeps a not-yet-created file legal and still catches ``..``
    traversal, absolute escapes, symlink redirection and UNC escape.
    """
    if not candidate or not root:
        return False
    try:
        Path(candidate).expanduser().resolve(strict=False).relative_to(
            Path(root).expanduser().resolve(strict=False)
        )
        return True
    except (ValueError, OSError):
        return False


def assert_within_root(candidate: str, root: str | None) -> str:
    """Return the normalised path, or raise :class:`PathOutOfScope`."""
    if not root:
        # No root configured: skip the local pre-check and let Django decide
        # (§9.3).  Still refuse an obviously non-absolute path.
        return normalize_path(candidate)
    if not is_within_root(candidate, root):
        raise PathOutOfScope(path=normalize_path(candidate), root=normalize_path(root))
    return normalize_path(candidate)


def assert_all_within_root(paths: list[str] | tuple[str, ...] | None, root: str | None) -> list[str]:
    """Containment-check every agent-supplied path before any bytes leave (§9.3)."""
    if not paths:
        return []
    return [assert_within_root(path, root) for path in paths]
