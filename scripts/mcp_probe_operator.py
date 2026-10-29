"""MCP conformance probe for the two orientation/escalation tools.

`scripts/mcp_probe.py` covers the frozen core protocol against the operator's
real backend. This probe does the same over a **scratch** instance so it can
exercise `search_tasks` and `request_claim_limit` end to end — including the
proof that an agent cannot raise its own limit — without touching live projects.

Usage (a scratch backend must be running):

    python scripts/mcp_probe_operator.py --base http://127.0.0.1:8599 --token verify-token
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
PY = REPO / ".venv" / "Scripts" / "python.exe"
PY = PY if PY.exists() else Path(sys.executable)

RESULTS: list[tuple[str, bool, str]] = []


def check(name: str, passed: bool, detail: str = "") -> None:
    RESULTS.append((name, passed, detail))
    print(f"  {'PASS' if passed else 'FAIL'}  {name}" + (f"  [{detail}]" if detail else ""))


def _payload(result) -> dict | None:
    chunks = [getattr(item, "text", "") for item in getattr(result, "content", []) or []]
    text = "\n".join(chunk for chunk in chunks if chunk)
    try:
        parsed = json.loads(text)
    except (json.JSONDecodeError, TypeError):
        return None
    return parsed if isinstance(parsed, dict) else None


async def probe(base: str, token: str, slug: str) -> int:
    from mcp import ClientSession, StdioServerParameters
    from mcp.client.stdio import stdio_client

    env = {
        "ATLAS_BACKEND_URL": base,
        "ATLAS_API_TOKEN": token,
        "ATLAS_AGENT_ID": "Agent-Probe",
        "ATLAS_PROJECT_SLUG": slug,
        "ATLAS_LOG_LEVEL": "WARNING",
        "ATLAS_STORAGE_ROOT": str(REPO / "storage"),
    }
    params = StdioServerParameters(
        command=str(PY), args=["-m", "mcp_server"], env=env, cwd=str(REPO)
    )

    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()

            listed = await session.list_tools()
            names = sorted(tool.name for tool in listed.tools)
            check(
                "all 10 tools advertised",
                names
                == sorted(
                    [
                        "claim_next_task",
                        "propose_task",
                        "submit_for_review",
                        "log_task_progress",
                        "task_heartbeat",
                        "update_dod_item",
                        "spawn_subtask",
                        "get_task_details",
                        "search_tasks",
                        "request_claim_limit",
                    ]
                ),
                f"{len(names)}",
            )

            # --- search_tasks ---------------------------------------------
            found = _payload(
                await session.call_tool(
                    "search_tasks",
                    {"project_slug": slug, "q": "POS terminal", "limit": 5},
                )
            )
            check("search_tasks returns a body", found is not None)
            check(
                "search_tasks finds the POS work",
                bool(found) and found.get("count", 0) >= 1,
                str((found or {}).get("count")),
            )
            check(
                "search_tasks rows are shortlist-sized",
                bool(found)
                and all(
                    set(row) <= {
                        "task_id", "title", "status", "priority", "is_blocked",
                        "is_agent_discovered", "dod_progress_percent",
                        "assigned_agent_id",
                    }
                    for row in found.get("items", [])
                ),
            )

            invalid = _payload(
                await session.call_tool(
                    "search_tasks", {"project_slug": slug, "limit": 999}
                )
            )
            check(
                "an out-of-range limit is an INVALID_ARGUMENT body",
                bool(invalid) and invalid.get("error", {}).get("code") == "INVALID_ARGUMENT",
                str((invalid or {}).get("error", {}).get("code")),
            )

            # --- request_claim_limit --------------------------------------
            asked = _payload(
                await session.call_tool(
                    "request_claim_limit",
                    {
                        "project_slug": slug,
                        "requested_limit": 9,
                        "reason": "Probe: several independent fixes are queued.",
                    },
                )
            )
            check("request_claim_limit returns PENDING",
                  bool(asked) and asked.get("status") == "PENDING",
                  str((asked or {}).get("status")))
            check(
                "the ask does not claim the limit changed",
                bool(asked) and "cannot be raised by an agent" in (asked.get("note") or ""),
            )
            check("request_id is returned", bool(asked) and bool(asked.get("request_id")))

            too_low = _payload(
                await session.call_tool(
                    "request_claim_limit",
                    {"project_slug": slug, "requested_limit": 9, "reason": "same"},
                )
            )
            # Same target while still pending: idempotent, same id.
            check(
                "re-asking for a pending target is idempotent",
                bool(too_low) and too_low.get("request_id") == (asked or {}).get("request_id"),
            )

    failed = [name for name, ok, _ in RESULTS if not ok]
    print("\n" + "=" * 60)
    if failed:
        print(f"FAILED — {len(failed)} of {len(RESULTS)}: {failed}")
        return 1
    print(f"PASSED — {len(RESULTS)} checks")
    return 0


def main() -> int:
    import asyncio

    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://127.0.0.1:8599")
    parser.add_argument("--token", default="verify-token")
    parser.add_argument("--slug", default="verify-project")
    args = parser.parse_args()
    return asyncio.run(probe(args.base, args.token, args.slug))


if __name__ == "__main__":
    sys.exit(main())
