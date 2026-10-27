"""ATLAS-MCP MCP server (Doc 08).

Exports the package version and the frozen wire contract version only; all
transport wiring lives in `mcp_server.server` so importing this package stays
side-effect free.
"""

from __future__ import annotations

__all__ = ["__version__", "CONTRACT_VERSION"]

__version__ = "0.1.0"

#: Mirrors Doc 01 §1.2; every tool response is validated against it.
CONTRACT_VERSION = "1.0.0"
