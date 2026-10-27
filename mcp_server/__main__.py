"""``python -m mcp_server`` -- stdio entry point (Doc 08 §2, §4).

Exit codes: ``0`` clean shutdown on stdin EOF, ``2`` invalid configuration
(:data:`mcp_server.server.EXIT_CONFIG_ERROR`).  An unreachable backend is **not**
an error here; the server starts ``Degraded`` so the agent still discovers the
tools and can retry later (§4.3).
"""

from __future__ import annotations

import sys

from .server import main as _server_main


def main(argv: list[str] | None = None) -> int:
    try:
        return _server_main(argv)
    except KeyboardInterrupt:  # pragma: no cover - interactive shutdown
        return 0


if __name__ == "__main__":
    sys.exit(main())
