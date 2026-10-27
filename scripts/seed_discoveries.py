"""Re-propose the triage fixtures used by the E2E suite (Doc 10 §4).

`seed_demo.py` creates the two demo discoveries, but the triage tests *consume*
them, so a second run finds an empty inbox. This script is idempotent: it checks
for live `PENDING_APPROVAL` rows first and only proposes when there are none.

Usage:  python scripts/seed_discoveries.py
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]

FIXTURES = (
    {
        "title": "Discovery triage keyboard shortcuts",
        "description": "j/k move the highlight but a/r never fire.",
        "suggested_priority": 85,
        "discovered_by_agent": "Agent-Claude",
        "discovery_reason": "Observed while running keyboard.spec.ts.",
    },
    {
        "title": "Migrate canvas autosave to IndexedDB",
        "description": "localStorage hits its 5 MB quota on large canvases.",
        "suggested_priority": 63,
        "discovered_by_agent": "Agent-Copilot",
        "discovery_reason": "QuotaExceededError in the console during export.",
    },
)


def read_env() -> dict[str, str]:
    values: dict[str, str] = {}
    path = REPO / ".env"
    if not path.is_file():
        return values
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        values[key.strip()] = value.strip().strip("'\"")
    return values


def call(base: str, token: str, method: str, path: str, body=None, agent: str | None = None):
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    if agent:
        headers["X-ATLAS-Agent"] = agent
    request = urllib.request.Request(
        base + path,
        method=method,
        data=None if body is None else json.dumps(body).encode(),
        headers=headers,
    )
    with urllib.request.urlopen(request) as response:
        payload = response.read().decode()
        return response.status, json.loads(payload) if payload else None


def main() -> int:
    env = read_env()
    token = env.get("ATLAS_API_TOKEN") or os.environ.get("ATLAS_API_TOKEN", "")
    base = (env.get("ATLAS_BACKEND_URL") or "http://127.0.0.1:8471").rstrip("/")
    slug = env.get("ATLAS_PROJECT_SLUG") or "alpha"

    if not token:
        sys.stderr.write("[X] ATLAS_API_TOKEN is missing; run scripts\\bootstrap_dev.py first.\n")
        return 1

    try:
        _, inbox = call(base, token, "GET", "/api/v1/discoveries/")
    except (urllib.error.URLError, OSError) as exc:
        sys.stderr.write(f"[X] backend unreachable at {base}: {exc}\n")
        return 1

    if inbox and inbox.get("items"):
        print(f"[i] {len(inbox['items'])} discovery(ies) already pending; nothing to do")
        return 0

    try:
        _, tasks = call(base, token, "GET", f"/api/v1/projects/{slug}/tasks/?limit=1")
    except (urllib.error.URLError, OSError) as exc:
        sys.stderr.write(f"[X] could not read tasks for {slug}: {exc}\n")
        return 1

    rows = (tasks or {}).get("items") or []
    if not rows:
        sys.stderr.write(f"[X] project '{slug}' has no tasks to discover during.\n")
        return 1

    origin = rows[0]["id"]
    created = 0
    for fixture in FIXTURES:
        body = {
            "project_slug": slug,
            "discovered_during_task_id": origin,
            **fixture,
        }
        try:
            call(base, token, "POST", "/internal/v1/propose", body, agent=fixture["discovered_by_agent"])
            created += 1
        except urllib.error.HTTPError as exc:
            sys.stderr.write(f"[X] propose failed for {fixture['title']}: {exc.read().decode()}\n")
            return 1

    print(f"[+] re-proposed {created} discovery fixture(s) for '{slug}'")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
