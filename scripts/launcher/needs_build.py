"""Does the existing Next.js production bundle need rebuilding?

Compares `frontend/.next/BUILD_ID` against the newest tracked source file.
Exit code 0 -> bundle is current, 1 -> rebuild needed.

Deliberately conservative: any error (missing file, unreadable dir) returns 1
so the launcher rebuilds rather than serving a stale bundle.
"""

from __future__ import annotations

import sys
from pathlib import Path

#: Directories that participate in a build.
SOURCE_DIRS = ("app", "components", "hooks", "lib", "styles")
#: Root-level files that participate in a build.
SOURCE_FILES = (
    "package.json",
    "next.config.ts",
    "tsconfig.json",
    "postcss.config.mjs",
)
SOURCE_SUFFIXES = {".ts", ".tsx", ".css", ".json", ".mjs"}


def newest_source_mtime(frontend: Path) -> float:
    newest = 0.0
    for name in SOURCE_FILES:
        candidate = frontend / name
        if candidate.is_file():
            newest = max(newest, candidate.stat().st_mtime)
    for name in SOURCE_DIRS:
        root = frontend / name
        if not root.is_dir():
            continue
        for path in root.rglob("*"):
            if path.suffix in SOURCE_SUFFIXES and path.is_file():
                newest = max(newest, path.stat().st_mtime)
    return newest


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        sys.stderr.write("usage: needs_build.py <frontend-dir>\n")
        return 1

    frontend = Path(argv[1]).resolve()
    build_id = frontend / ".next" / "BUILD_ID"
    if not build_id.is_file():
        print("no BUILD_ID -> build required")
        return 1

    built_at = build_id.stat().st_mtime
    changed_at = newest_source_mtime(frontend)
    if changed_at > built_at:
        print("sources newer than BUILD_ID -> build required")
        return 1

    print("bundle is current")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
