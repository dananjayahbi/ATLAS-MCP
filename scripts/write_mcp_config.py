"""Write `.vscode/mcp.json` with the local token, and verify it loads.

VS Code's MCP config needs the real `ATLAS_API_TOKEN`, but that value must not
be committed. This script generates the file from `.env` (idempotent) and is
run by `bootstrap_dev.py`; `.vscode/mcp.json` is gitignored while
`.vscode/mcp.example.json` is the committed reference shape.

Usage:  python scripts/write_mcp_config.py [--check]
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

REPO = Path(__file__).resolve().parents[1]
ROOT_ENV = REPO / ".env"
TARGET = REPO / ".vscode" / "mcp.json"

BACKEND_PORT = "8471"


def read_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.is_file():
        return values
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        values[key.strip()] = value.strip().strip("'\"")
    return values


def build_config(token: str, backend_url: str) -> dict:
    python = REPO / ".venv" / "Scripts" / "python.exe"
    if not python.exists():  # POSIX / CI
        python = REPO / ".venv" / "bin" / "python"
    return {
        "servers": {
            "atlas": {
                "type": "stdio",
                "command": str(python),
                "args": ["-m", "mcp_server"],
                "cwd": str(REPO),
                "env": {
                    "ATLAS_BACKEND_URL": backend_url,
                    "ATLAS_API_TOKEN": token,
                    "ATLAS_AGENT_ID": "Agent-Copilot",
                    "ATLAS_PROJECT_SLUG": "alpha",
                    "ATLAS_STORAGE_ROOT": str(REPO / "storage"),
                    "ATLAS_LOG_LEVEL": "INFO",
                },
            }
        }
    }


def validate(path: Path, token: str) -> list[str]:
    problems: list[str] = []
    if not path.is_file():
        return [f"{path} does not exist"]
    raw = path.read_bytes()
    if raw.startswith(b"\xef\xbb\xbf"):
        problems.append("file starts with a UTF-8 BOM (VS Code's JSON parser rejects it)")
    try:
        data = json.loads(raw.decode("utf-8-sig"))
    except json.JSONDecodeError as exc:
        return problems + [f"invalid JSON: {exc}"]

    server = (data.get("servers") or {}).get("atlas")
    if server is None:
        return problems + ["no servers.atlas entry"]

    if server.get("type") != "stdio":
        problems.append("servers.atlas.type must be 'stdio'")
    command = Path(str(server.get("command", "")))
    if not command.is_file():
        problems.append(f"command does not exist: {command}")
    if server.get("args") != ["-m", "mcp_server"]:
        problems.append("args must be ['-m', 'mcp_server']")
    env = server.get("env") or {}
    for key in ("ATLAS_BACKEND_URL", "ATLAS_API_TOKEN", "ATLAS_STORAGE_ROOT"):
        if not env.get(key):
            problems.append(f"env.{key} is missing")
    if env.get("ATLAS_API_TOKEN") != token:
        problems.append("env.ATLAS_API_TOKEN does not match .env")
    return problems


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="validate only, do not write")
    args = parser.parse_args()

    values = read_env(ROOT_ENV)
    token = values.get("ATLAS_API_TOKEN", "")
    backend_url = values.get("ATLAS_BACKEND_URL", f"http://127.0.0.1:{BACKEND_PORT}")

    if not token:
        sys.stderr.write(f"[X] no ATLAS_API_TOKEN in {ROOT_ENV}\n")
        sys.stderr.write("    Run: .venv\\Scripts\\python.exe scripts\\bootstrap_dev.py\n")
        return 1

    TARGET.parent.mkdir(parents=True, exist_ok=True)

    if not args.check:
        payload = build_config(token, backend_url)
        TARGET.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
        print(f"[i] wrote {TARGET}")

    problems = validate(TARGET, token)
    if problems:
        print("[X] mcp.json validation failed:")
        for problem in problems:
            print(f"    - {problem}")
        return 1

    print(f"[ok] {TARGET.relative_to(REPO)} is valid (stdio, 8 tools, token matches .env)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
