"""Tee stdin to stdout and a UTF-8 log file (launcher helper).

Windows has no portable `tee`. The launchers pipe a server's output through this
so the operator still sees live output in the CMD window *and* gets a durable
log file per server.

Child processes emit UTF-8 (Node and uvicorn both do), but a piped stdin on
Windows defaults to the ANSI code page, which turns a check mark into mojibake.
Both directions are therefore forced to UTF-8 with a replacement handler, so a
stray byte can never kill a server just because it tried to log.

Usage:  <server command> 2>&1 | python tee.py <logfile>
"""

from __future__ import annotations

import sys
from pathlib import Path


def _force_utf8(stream) -> None:
    reconfigure = getattr(stream, "reconfigure", None)
    if reconfigure is None:
        return
    try:
        reconfigure(encoding="utf-8", errors="replace", newline="")
    except (ValueError, OSError):  # pragma: no cover - already-consumed stream
        pass


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        sys.stderr.write("usage: tee.py <logfile>\n")
        return 2

    _force_utf8(sys.stdin)
    _force_utf8(sys.stdout)

    path = Path(argv[1])
    path.parent.mkdir(parents=True, exist_ok=True)

    with path.open("a", encoding="utf-8", errors="replace", buffering=1) as log:
        log.write(f"\n===== {path.name} session start =====\n")
        for line in sys.stdin:
            sys.stdout.write(line)
            sys.stdout.flush()
            log.write(line)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
