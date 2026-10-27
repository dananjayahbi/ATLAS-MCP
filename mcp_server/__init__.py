"""ATLAS MCP protocol adapter.

A stateless, thin adapter that turns agent MCP tool calls into
``POST /internal/v1/*`` requests against the Django core and projects the
response down to the smallest JSON that still lets an agent write code
(Doc 08 §1.1).  Nothing here imports Django, touches ``storage/``, or writes a
byte to stdout outside the MCP framing.
"""

__version__ = "0.1.0"
CONTRACT_VERSION = "1.0.0"

__all__ = ["__version__", "CONTRACT_VERSION"]
