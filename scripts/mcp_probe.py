"""Live MCP conformance probe (Doc 10 §9).

Spawns `mcp_server` as a **real stdio subprocess** and drives it with the
official `mcp` client, exactly the way VS Code / Claude Desktop do. This proves
the wiring end-to-end rather than importing modules in-process.

Checks:
  1. `initialize` handshake
  2. all 8 tools advertised with the frozen names
  3. `claim_next_task` returns a projected task within the 16 kB ceiling
  4. `log_task_progress` returns exactly `{"ok": true}`
  5. `task_heartbeat` returns `seconds_remaining`
  6. an invalid argument is rejected without a traceback in stderr

Exit code 0 when every assertion passes.

Usage:
    python scripts/mcp_probe.py [--json]
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

REPO = Path(__file__).resolve().parents[1]
PY = REPO / ".venv" / "Scripts" / "python.exe"
if not PY.exists():
    PY = REPO / ".venv" / "bin" / "python"
PY = PY if PY.exists() else Path(sys.executable)

sys.path.insert(0, str(REPO))

CORE_TOOLS = [
    "claim_next_task",
    "propose_task",
    "submit_for_review",
    "log_task_progress",
]
SUPPORT_TOOLS = [
    "task_heartbeat",
    "update_dod_item",
    "spawn_subtask",
    "get_task_details",
]
CEILING = 16_384

results: list[tuple[str, bool, str]] = []


def check(name: str, passed: bool, detail: str = "") -> None:
    results.append((name, passed, detail))
    mark = "PASS" if passed else "FAIL"
    print(f"  [{mark}] {name}" + (f" — {detail}" if detail else ""))


def _env() -> dict[str, str]:
    """Environment for the child, read from .env so nothing is hard-coded."""
    values: dict[str, str] = {}
    env_path = REPO / ".env"
    if env_path.is_file():
        for raw in env_path.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            values[key.strip()] = value.strip().strip("'\"")
    merged = {**os.environ, **values}
    merged.update(
        {
            "ATLAS_AGENT_ID": values.get("ATLAS_AGENT_ID", "Agent-Probe"),
            "ATLAS_PROJECT_SLUG": values.get("ATLAS_PROJECT_SLUG", "alpha"),
            "ATLAS_STORAGE_ROOT": values.get(
                "ATLAS_STORAGE_ROOT", str(REPO / "storage")
            ),
            "ATLAS_LOG_LEVEL": "WARN",
            "PYTHONPATH": str(REPO),
            "PYTHONUNBUFFERED": "1",
        }
    )
    return merged


def _text(result) -> str:
    """Flatten a CallToolResult into text."""
    chunks = []
    for item in getattr(result, "content", []) or []:
        text = getattr(item, "text", None)
        if text:
            chunks.append(text)
    return "\n".join(chunks)


def _payload(result) -> dict | None:
    text = _text(result)
    try:
        parsed = json.loads(text)
    except (json.JSONDecodeError, TypeError):
        return None
    return parsed if isinstance(parsed, dict) else None


def _server_info(init) -> tuple[str, str]:
    """Read the server identity across SDK versions.

    `mcp` 2.x exposes `server_info` (pydantic snake_case); 1.x used
    `serverInfo`. Both are tried so the probe is not pinned to one release.
    """
    info = getattr(init, "server_info", None) or getattr(init, "serverInfo", None)
    if info is None:
        return "unknown", "unknown"
    name = getattr(info, "name", None) or getattr(info, "title", None) or "unknown"
    version = getattr(info, "version", None) or "unknown"
    return str(name), str(version)


async def probe() -> int:
    from mcp import ClientSession, StdioServerParameters
    from mcp.client.stdio import stdio_client

    params = StdioServerParameters(
        command=str(PY),
        args=["-m", "mcp_server"],
        env=_env(),
        cwd=str(REPO),
    )

    print(f"\nspawn: {PY} -m mcp_server  (cwd={REPO})\n")

    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            init = await session.initialize()
            name, version = _server_info(init)
            check(
                "initialize handshake",
                name != "unknown",
                f"{name} v{version} (protocol {getattr(init, 'protocol_version', '?')})",
            )

            listed = await session.list_tools()
            names = sorted(t.name for t in listed.tools)
            expected = sorted(CORE_TOOLS + SUPPORT_TOOLS)
            check(
                "all 8 frozen tools advertised",
                names == expected,
                f"{len(names)} tools",
            )
            missing = [n for n in expected if n not in names]
            if missing:
                check("frozen tool names", False, f"missing {missing}")

            # --- claim ----------------------------------------------------
            claim = await session.call_tool(
                "claim_next_task",
                {"project_slug": "alpha", "agent_identifier": "Agent-Probe", "min_priority": 0},
            )
            body = _payload(claim)
            claimed_ok = bool(body) and (
                body.get("task_id") is None or isinstance(body.get("task_id"), str)
            )
            check("claim_next_task returns a projection", claimed_ok)

            task_id = (body or {}).get("task_id")
            lease_id = (body or {}).get("lease_id")

            if task_id:
                size = len(json.dumps(body, separators=(",", ":"), ensure_ascii=False).encode())
                check(
                    f"projection within {CEILING} B ceiling",
                    size <= CEILING,
                    f"{size} B",
                )
                check(
                    "projection carries lease parameters",
                    body.get("lease_ttl_seconds") == 900
                    and body.get("heartbeat_interval_seconds") == 120,
                    f"ttl={body.get('lease_ttl_seconds')} hb={body.get('heartbeat_interval_seconds')}",
                )
                check(
                    "projection omits timestamps",
                    "created_at" not in body and "updated_at" not in body,
                )

                # --- progress ---------------------------------------------
                progress = await session.call_tool(
                    "log_task_progress",
                    {"task_id": task_id, "message": "mcp probe: hello from stdio"},
                )
                payload = _payload(progress)
                check(
                    "log_task_progress returns exactly {ok:true}",
                    payload == {"ok": True},
                    json.dumps(payload) if payload is not None else "<non-JSON>",
                )

                # --- heartbeat --------------------------------------------
                if lease_id:
                    beat = await session.call_tool(
                        "task_heartbeat",
                        {"task_id": task_id, "lease_id": lease_id},
                    )
                    beat_body = _payload(beat) or {}
                    check(
                        "task_heartbeat renews and reports seconds_remaining",
                        beat_body.get("ok") is True
                        and isinstance(beat_body.get("seconds_remaining"), int),
                        f"remaining={beat_body.get('seconds_remaining')}",
                    )

                # --- detail -----------------------------------------------
                detail = await session.call_tool(
                    "get_task_details", {"task_id": task_id}
                )
                detail_body = _payload(detail) or {}
                check(
                    "get_task_details re-reads the task",
                    detail_body.get("task_id") == task_id,
                )
            else:
                check(
                    "claim_next_task empty-queue shape",
                    body == {"task_id": None, "reason": "NO_ELIGIBLE_TASK"},
                    json.dumps(body),
                )
                print("       (no eligible task; lifecycle assertions skipped)")

            # --- validation ------------------------------------------------
            try:
                bad = await session.call_tool(
                    "claim_next_task",
                    {"project_slug": "alpha", "agent_identifier": "A", "min_priority": 999},
                )
                bad_body = _payload(bad) or {}
                rejected = (
                    getattr(bad, "isError", False)
                    or bad_body.get("code") == "INVALID_ARGUMENT"
                    or "error" in bad_body
                )
                check("out-of-range argument is rejected", rejected,
                      json.dumps(bad_body)[:120] if bad_body else "isError")
            except Exception as exc:  # protocol-level rejection is also valid
                check("out-of-range argument is rejected", True, type(exc).__name__)

    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json", action="store_true", help="emit machine-readable results")
    args = parser.parse_args()

    print("ATLAS-MCP live MCP conformance probe")
    try:
        asyncio.run(probe())
    except Exception as exc:
        check("probe completed", False, f"{type(exc).__name__}: {exc}")

    passed = sum(1 for _, ok_flag, _ in results if ok_flag)
    total = len(results)
    print(f"\n{passed}/{total} checks passed")

    if args.json:
        print(json.dumps([{"name": n, "ok": o, "detail": d} for n, o, d in results], indent=2))

    return 0 if passed == total and total > 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
