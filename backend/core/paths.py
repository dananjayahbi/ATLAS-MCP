"""Filesystem containment validation (Doc 01 §14.3, Doc 02 §8.6).

Every path that arrives from an agent or a browser passes through `resolve_under`.
Anything that escapes `ATLAS_STORAGE_ROOT` raises `PathOutOfScope`; there is no
"warn and continue" mode.
"""

from __future__ import annotations

from pathlib import Path

from django.conf import settings

from core.errors import PathOutOfScope


def storage_root() -> Path:
    return Path(settings.ATLAS_STORAGE_ROOT).resolve()


def is_within(candidate: Path, root: Path) -> bool:
    try:
        candidate.resolve().relative_to(root.resolve())
    except (ValueError, OSError):
        return False
    return True


def resolve_under(candidate: str | Path, root: Path | None = None) -> Path:
    """Resolve `candidate` and assert it lives inside `root`."""
    base = (root or storage_root()).resolve()
    raw = Path(candidate)
    resolved = raw.resolve() if raw.is_absolute() else (base / raw).resolve()
    if not is_within(resolved, base):
        raise PathOutOfScope(
            "Supplied path escapes ATLAS_STORAGE_ROOT.",
            detail={"path": str(candidate)},
        )
    return resolved


def to_posix_relative(absolute: str | Path, root: Path | None = None) -> str:
    """Absolute → POSIX-relative path stored in the DB (Doc 01 §11 dual-path rule)."""
    base = (root or storage_root()).resolve()
    resolved = resolve_under(absolute, base)
    return resolved.relative_to(base).as_posix()


def to_absolute_native(relative: str | Path, root: Path | None = None) -> str:
    """POSIX-relative DB path → absolute native path for a response."""
    base = (root or storage_root()).resolve()
    return str((base / Path(str(relative))).resolve())


def safe_join(root: Path, *parts: str) -> Path:
    """Join and verify, dropping any traversal segments supplied by callers."""
    candidate = root.joinpath(*[p for p in parts if p not in {"", ".", ".."}])
    resolved = candidate.resolve()
    if not is_within(resolved, root):
        raise PathOutOfScope("Joined path escapes its root.", detail={"root": str(root)})
    return resolved
