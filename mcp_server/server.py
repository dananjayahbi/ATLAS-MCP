"""Server bootstrap: one ``MCPServer`` instance plus the registration loop.

Doc 08 §5.1 in spirit, adapted to the installed SDK: ``mcp`` 2.x renamed
``FastMCP`` to ``MCPServer`` (``mcp.server.mcpserver``), so imports are done
against that module while the behaviour -- stdio transport, one tool per
module, no business logic here -- is unchanged.

Nothing blocking happens at import time: :func:`build` creates the server and
registers the tools, and :func:`main` is the only function that reads the
environment or touches the network.
"""

from __future__ import annotations

import logging
import sys
from typing import Any

from mcp.server.mcpserver import MCPServer

from . import __version__
from .client import AtlasClient
from .config import ConfigError, Settings, load_from_argv
from .tools import TOOLS, TOOL_NAMES

LOGGER = logging.getLogger("atlas.mcp")

SERVER_NAME = "atlas"

#: Invalid configuration is fatal: no retry can fix an operator mistake (§4.1).
EXIT_CONFIG_ERROR = 2


def configure_stderr_logging(level: str = "INFO", *, debug: bool = False) -> None:
    """Send every log record to stderr; stdout belongs to MCP framing (§13.2).

    Third-party handlers bound to stdout are removed too: one stray byte on
    stdout corrupts the JSON-RPC stream and the agent sees a parse failure with
    no diagnostic.
    """
    numeric = getattr(logging, level.upper(), logging.INFO)
    if debug:
        numeric = logging.DEBUG

    root = logging.getLogger()
    for handler in list(root.handlers):
        if getattr(handler, "stream", None) is sys.stdout:
            root.removeHandler(handler)

    if not any(
        isinstance(handler, logging.StreamHandler) and getattr(handler, "stream", None) is sys.stderr
        for handler in root.handlers
    ):
        handler = logging.StreamHandler(sys.stderr)
        handler.setFormatter(
            logging.Formatter(
                fmt="%(asctime)s %(levelname)-5s %(name)s %(message)s",
                datefmt="%Y-%m-%dT%H:%M:%S",
            )
        )
        root.addHandler(handler)
    root.setLevel(numeric)


def build(cfg: Settings, *, client: Any = None) -> MCPServer:
    """Create the server and register all eight tools in the frozen order."""
    mcp = MCPServer(
        name=SERVER_NAME,
        version=__version__,
        instructions=None,  # §10.1: the agent contract lives in the workspace, not the handshake
        log_level="WARNING",
    )
    atlas_client = client if client is not None else AtlasClient(cfg)
    for spec in TOOLS:
        spec.register(mcp, cfg, atlas_client)
    LOGGER.debug("registered tools: %s", ", ".join(TOOL_NAMES))
    return mcp


def probe_backend(cfg: Settings, client: Any) -> bool:
    """One non-retried ``/healthz`` probe. Failure is a warning, never fatal (§4.3)."""
    probe = getattr(client, "probe_health", None)
    if probe is None:  # pragma: no cover - injected test doubles
        return True
    healthy, detail = probe()
    if healthy:
        LOGGER.info("backend healthz ok url=%s", cfg.backend_url)
        return True
    LOGGER.warning(
        "backend unreachable at %s (%s) -- starting in DEGRADED mode; tools stay listed",
        cfg.backend_url,
        detail,
    )
    return False


def main(argv: list[str] | None = None) -> int:
    """Entry point for ``python -m mcp_server``. Returns the process exit code."""
    try:
        cfg = load_from_argv(sys.argv[1:] if argv is None else argv)
    except ConfigError as exc:
        # No logging setup yet: write straight to stderr so the operator sees it.
        sys.stderr.write(f"atlas-mcp configuration error: {exc}\n")
        sys.stderr.flush()
        return EXIT_CONFIG_ERROR

    configure_stderr_logging(cfg.log_level, debug=cfg.debug)
    LOGGER.info(cfg.banner())
    for warning in cfg.warnings:
        LOGGER.warning(warning)

    client = AtlasClient(cfg)
    try:
        probe_backend(cfg, client)
        mcp = build(cfg, client=client)
        LOGGER.info("serving %d tools over stdio", len(TOOL_NAMES))
        mcp.run(transport="stdio")
    finally:
        client.close()
    return 0


__all__ = [
    "EXIT_CONFIG_ERROR",
    "SERVER_NAME",
    "build",
    "configure_stderr_logging",
    "main",
    "probe_backend",
]
