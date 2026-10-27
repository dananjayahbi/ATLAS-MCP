"""Generate the frontend mock fixture pack defined by Doc 01 §16.

Deterministic: no randomness, no clock reads. Re-running produces byte-identical
files so the fixture pack can be committed and diffed.

Usage:  python scripts/gen_mocks.py
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "frontend" / "lib" / "mocks"

# Fixed "now" so fixtures are reproducible (matches Doc 01 §7 examples).
NOW = datetime(2026, 10, 27, 8, 10, 11, 297000, tzinfo=timezone.utc)

ALPHA = "b3f1c0a4-7d21-4a6e-9f5c-2a1e8d6f0c11"
BETA = "c4a2d1b5-8e32-4b7f-a06d-3b2f9e7a1d22"
STORAGE = r"E:\My_GitHub_Repos\ATLAS-MCP\storage\projects"


def iso(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"


def hours_ago(h: float) -> str:
    return iso(NOW - timedelta(hours=h))


TASKS = [
    # (title, status, priority, dod_done, dod_total, age_h, agent, discovered, blocked, dep_w)
    ("Fix JWT expiry race condition", "IN_PROGRESS", 95, 2, 3, 27.4, "Agent-Claude", False, False, 1.5),
    ("Replace deprecated auth middleware", "PENDING", 88, 0, 4, 51.2, None, False, False, 2.0),
    ("Add WAL checkpoint telemetry", "PENDING", 72, 1, 5, 44.0, None, True, False, 1.0),
    ("Harden asset upload MIME sniffing", "IN_REVIEW", 84, 4, 4, 33.5, "Agent-Claude", False, False, 0.5),
    ("Priority matrix empty-state copy", "PENDING", 41, 0, 2, 12.0, None, False, False, 0.0),
    ("Board column collapse animation", "COMPLETED", 55, 3, 3, 88.0, "Agent-Copilot", False, False, 0.0),
    ("SSE reconnect backoff unit tests", "COMPLETED", 61, 2, 2, 93.0, "Agent-Claude", False, False, 0.0),
    ("Discovery triage keyboard shortcuts", "PENDING_APPROVAL", 85, 0, 3, 2.5, "Agent-Claude", True, False, 0.0),
    ("Migrate canvas autosave to IndexedDB", "PENDING_APPROVAL", 63, 0, 4, 1.2, "Agent-Copilot", True, False, 0.0),
    ("Lease sweep interval configurable", "PENDING", 48, 0, 2, 20.0, None, False, True, 3.0),
    ("Rejected: swap chart lib for D3", "REJECTED", 30, 0, 1, 70.0, None, True, False, 0.0),
    ("Agent heartbeat jitter tolerance", "PENDING", 100, 1, 4, 0.5, None, False, False, 2.5),
]

BETA_TASKS = [
    ("Sync fixture pack with schema", "PENDING", 70, 0, 3, 30.0, None, False, False, 1.0),
    ("Add request-id correlation header", "IN_PROGRESS", 76, 1, 3, 18.0, "Agent-Copilot", False, False, 0.0),
    ("Terminal ring buffer eviction test", "IN_REVIEW", 58, 2, 2, 26.0, "Agent-Copilot", False, False, 0.0),
    ("Document intake pipeline", "COMPLETED", 44, 2, 2, 60.0, "Agent-Claude", False, False, 0.0),
    ("HUD density toggle", "PENDING", 35, 0, 3, 9.0, None, False, False, 0.5),
    ("Rate-limit 429 envelope", "PENDING", 66, 0, 2, 15.0, None, False, True, 1.5),
    ("Per-project accent persistence", "REJECTED", 25, 0, 1, 41.0, None, True, False, 0.0),
    ("Cursor pagination tie-break", "PENDING", 52, 1, 3, 22.0, None, False, False, 0.0),
    ("Verify DoD gauge a11y labels", "COMPLETED", 39, 3, 3, 55.0, "Agent-Copilot", False, False, 0.0),
]


def make_tasks(prefix: str, slug: str, rows, start: int = 1):
    out = []
    for i, (title, status, prio, done, total, age, agent, disc, blocked, dw) in enumerate(rows, start):
        out.append(
            {
                "id": f"{prefix}{i:04d}-1f0b-4c5b-9a2e-77d0d2f3c{900 + i}",
                "project_slug": slug,
                "title": title,
                "status": status,
                "priority": prio,
                "dod_progress_percent": round(done / total * 100) if total else 0,
                "is_agent_discovered": disc,
                "is_blocked": blocked,
                "parent_task_id": None,
                "age_hours": age,
                "dependency_weight": dw,
                "assigned_agent_id": agent,
                "lease_seconds_remaining": 612 if status == "IN_PROGRESS" else None,
                "created_at": hours_ago(age),
                "updated_at": hours_ago(max(0.1, age - 0.4)),
            }
        )
    return out


def asset(asset_id, kind, filename, size, source, task_id, sub, created):
    return {
        "id": asset_id,
        "kind": kind,
        "filename": filename,
        "mime_type": "image/png" if kind != "OUTPUT_PATCH" else "text/plain",
        "byte_size": size,
        "source": source,
        "absolute_path": f"{STORAGE}\\{ALPHA}\\tasks\\{task_id}\\{sub}\\{filename}",
        "url": f"/api/v1/assets/{asset_id}/content",
        "created_at": created,
    }


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    alpha_tasks = make_tasks("5f2d6c", "alpha", TASKS)
    beta_tasks = make_tasks("6a3e7d", "beta", BETA_TASKS)
    all_tasks = alpha_tasks + beta_tasks

    def counters_for(slug):
        rows = [t for t in all_tasks if t["project_slug"] == slug]
        g = lambda s: sum(1 for t in rows if t["status"] == s)
        completed = g("COMPLETED")
        denom = completed + g("PENDING") + g("IN_PROGRESS") + g("IN_REVIEW")
        return {
            "pending": g("PENDING"),
            "in_progress": g("IN_PROGRESS"),
            "in_review": g("IN_REVIEW"),
            "completed": completed,
            "pending_approval": g("PENDING_APPROVAL"),
            "health_percent": round(completed / denom * 100) if denom else 0,
        }

    projects = [
        {
            "contract_version": "1.0.0",
            "id": ALPHA,
            "slug": "alpha",
            "name": "Alpha Backend",
            "local_repo_path": "E:\\dev\\alpha",
            "accent_color": "#00F2FE",
            "global_rules_md": "Use pnpm. Tests: pytest -q. Never touch `legacy/`.",
            "archived_at": None,
            "created_at": hours_ago(160),
            "updated_at": hours_ago(0.3),
            "counters": counters_for("alpha"),
            "active_agent_id": "Agent-Claude",
            "last_event_at": hours_ago(0.02),
        },
        {
            "contract_version": "1.0.0",
            "id": BETA,
            "slug": "beta",
            "name": "Beta Dashboard",
            "local_repo_path": "E:\\dev\\beta",
            "accent_color": "#F59E0B",
            "global_rules_md": "Next 15 App Router. No new dependencies without an ADR.",
            "archived_at": None,
            "created_at": hours_ago(120),
            "updated_at": hours_ago(1.1),
            "counters": counters_for("beta"),
            "active_agent_id": "Agent-Copilot",
            "last_event_at": hours_ago(0.4),
        },
    ]

    # --- task detail ------------------------------------------------------
    detail = dict(alpha_tasks[0])
    detail.update(
        {
            "description": (
                "Two concurrent refreshes mint a token whose `exp` lands in the same second as the "
                "previous one. The refresh handler then reads a token it just rotated out and "
                "returns 401.\n\nRepro:\n\n```bash\npytest tests/auth -k race -x\n```"
            ),
            "definition_of_done": [
                {"id": 1, "label": "Repro test written", "completed": True, "completed_at": hours_ago(1.2)},
                {"id": 2, "label": "Mutex guard added", "completed": True, "completed_at": hours_ago(0.8)},
                {"id": 3, "label": "Migrations added", "completed": False, "completed_at": None},
            ],
            "blocked_by": [],
            "blocks": [alpha_tasks[1]["id"]],
            "child_task_ids": [],
            "discovered_during_task_id": None,
            "discovery_reason": "",
            "suggested_priority": None,
            "review_summary": "",
            "review_notes": "",
            "attempt_count": 1,
            "assets": [
                asset("0c7b1111-2222-4333-8444-555566667777", "ANNOTATED_CANVAS",
                      "annotated_canvas.png", 184320, "HUMAN", alpha_tasks[0]["id"], "input", hours_ago(26.9)),
                asset("0c7b8888-9999-4aaa-8bbb-ccccddddeeee", "INPUT_SCREENSHOT",
                      "source_screenshot.png", 209715, "HUMAN", alpha_tasks[0]["id"], "input", hours_ago(27.0)),
            ],
            "recent_events": [],
        }
    )

    # --- review queue -----------------------------------------------------
    review_task = dict(alpha_tasks[3])
    review_task.update(
        {
            "description": "Agent proposes byte-level MIME sniffing with an allow-list.",
            "dod_progress_percent": 100,
            "lease_seconds_remaining": None,
            "review_summary": "Added python-magic sniffing plus an allow-list on POST /api/v1/assets/.",
            "attempt_count": 2,
            "definition_of_done": [
                {"id": i, "label": lbl, "completed": True, "completed_at": hours_ago(2.0 - i * 0.1)}
                for i, lbl in enumerate(
                    ["Sniff MIME from bytes", "Allow-list enforced", "413 on oversize", "Unit tests added"], 1
                )
            ],
            "blocked_by": [],
            "blocks": [],
            "child_task_ids": [],
            "discovered_during_task_id": None,
            "discovery_reason": "",
            "suggested_priority": None,
            "review_notes": "",
            "assets": [
                asset("9e2f3333-4444-4555-8666-777788889999", "OUTPUT_PATCH",
                      "git_patch.patch", 8421, "AGENT", alpha_tasks[3]["id"], "output", hours_ago(1.4)),
            ],
            "recent_events": [],
        }
    )

    # --- discovery inbox --------------------------------------------------
    discovery_task = alpha_tasks[7]
    discovery = {
        "task_id": discovery_task["id"],
        "project_slug": "alpha",
        "title": discovery_task["title"],
        "description": "Triage inbox is keyboard-inaccessible: j/k move the highlight but a/r never fire.",
        "status": "PENDING_APPROVAL",
        "suggested_priority": 85,
        "priority": 85,
        "discovered_during_task_id": alpha_tasks[0]["id"],
        "discovered_by_agent": "Agent-Claude",
        "discovery_reason": "Observed while running keyboard.spec.ts during Task #104.",
        "assets": [
            asset("3d910000-1111-4222-8333-444455556666", "VERIFICATION_IMAGE",
                  "verification_depr_warning.png", 41270, "AGENT", discovery_task["id"], "output", hours_ago(2.5)),
        ],
        "screenshot_absolute_paths": [],
        "created_at": hours_ago(2.5),
    }
    discovery["screenshot_absolute_paths"] = [discovery["assets"][0]["absolute_path"]]

    # --- matrix / telemetry ----------------------------------------------
    matrix = {
        "points": [
            {
                "task_id": t["id"],
                "title": t["title"],
                "project_slug": t["project_slug"],
                "status": t["status"],
                "priority": t["priority"],
                "age_hours": t["age_hours"],
                "dependency_weight": t["dependency_weight"],
                "is_blocked": t["is_blocked"],
                "is_agent_discovered": t["is_agent_discovered"],
                "dod_progress_percent": t["dod_progress_percent"],
            }
            for t in all_tasks
        ],
        "axes": {"x": "age_hours", "x_alternate": "dependency_weight", "y": "priority", "y_max": 100},
    }

    statuses = ["PENDING_APPROVAL", "PENDING", "IN_PROGRESS", "IN_REVIEW", "COMPLETED", "REJECTED"]
    telemetry = {
        "projects": [
            {
                "slug": p["slug"],
                "health_percent": p["counters"]["health_percent"],
                "active_agent_id": p["active_agent_id"],
                "in_progress": p["counters"]["in_progress"],
            }
            for p in projects
        ],
        "tasks_by_status": {s: sum(1 for t in all_tasks if t["status"] == s) for s in statuses},
        "discoveries_pending": 2,
        "oldest_pending_age_hours": 51.2,
        "leases_expiring_within_5m": 0,
        "throughput_last_24h": 6,
        "generated_at": iso(NOW),
    }

    # --- SSE event log ----------------------------------------------------
    shapes = [
        ("task.created", "INFO", lambda t: f"Task created: {t['title']}"),
        ("task.log", "INFO", lambda t: "running: pytest tests/auth/ -k race"),
        ("task.log", "DEBUG", lambda t: "lease renewed, 900s remaining"),
        ("task.log", "WARN", lambda t: "retrying backend request (attempt 2/3)"),
        ("task.log", "ERROR", lambda t: "AssertionError: expected 200, got 401"),
        ("task.status_changed", "INFO", lambda t: "PENDING -> IN_PROGRESS"),
        ("task.dod_updated", "INFO", lambda t: "DoD item 2 marked complete"),
    ]
    events = []
    for i in range(60):
        t = alpha_tasks[i % len(alpha_tasks)]
        etype, level, render = shapes[i % len(shapes)]
        events.append(
            {
                "id": f"evt_01JA2Y7Q0K3M9V{i + 1:02d}",
                "seq": i + 1,
                "type": etype,
                "level": level,
                "project_slug": "alpha",
                "task_id": t["id"],
                "message": render(t),
                "payload": {"source": "fixture"} if etype == "task.log" else None,
                "ts": iso(NOW - timedelta(seconds=(60 - i) * 7)),
            }
        )

    # --- error samples (one per §7.8 code) --------------------------------
    errors = [
        ("VALIDATION_ERROR", "priority must be between 0 and 100", False, {"field": "priority"}),
        ("PATH_OUT_OF_SCOPE", "path escapes ATLAS_STORAGE_ROOT", False, {"path": "C:\\Windows\\system32"}),
        ("AUTH_MISSING", "Authorization header required", False, None),
        ("AUTH_INVALID", "API token rejected", False, None),
        ("PROJECT_NOT_FOUND", "no project with slug 'gamma'", False, {"slug": "gamma"}),
        ("TASK_NOT_FOUND", "task not found", False, {"task_id": alpha_tasks[0]["id"]}),
        ("ASSET_NOT_FOUND", "asset not found", False, None),
        ("INVALID_TRANSITION", "cannot requeue a PENDING task", False,
         {"from": "PENDING", "action": "requeue"}),
        ("TASK_ALREADY_LEASED", "task is leased by Agent-Claude", False,
         {"task_id": alpha_tasks[0]["id"], "assigned_agent_id": "Agent-Claude",
          "current_lease_id": "lea_01JA2Y7Q0K"}),
        ("STALE_LEASE", "lease_id does not match the live lease", False, {"task_id": alpha_tasks[0]["id"]}),
        ("DEPENDENCY_CYCLE", "blocked_by would create a cycle", False,
         {"cycle": [alpha_tasks[0]["id"], alpha_tasks[1]["id"]]}),
        ("DEPENDENCY_UNSATISFIABLE", "blocker was rejected", False,
         {"blocker_id": alpha_tasks[10]["id"]}),
        ("PAYLOAD_TOO_LARGE", "git_patch exceeds 5 MB", False, {"max_bytes": 5242880}),
        ("UNSUPPORTED_MEDIA_TYPE", "image/gif is not allowed", False,
         {"allowed": ["image/png", "image/jpeg", "image/webp", "text/plain", "text/markdown"]}),
        ("INTERNAL_ERROR", "unexpected server error", True, None),
        ("STORAGE_WRITE_FAILED", "os.replace failed: disk full", True, {"path": "storage/projects/"}),
        ("BACKEND_UNAVAILABLE", "Django backend unreachable", True, {"url": "http://127.0.0.1:8471"}),
    ]
    error_payload = {
        "items": [
            {
                "error": {
                    "code": code,
                    "message": msg,
                    "retryable": retry,
                    "detail": detail_,
                    "request_id": f"req_01JA2Y{i:04d}",
                }
            }
            for i, (code, msg, retry, detail_) in enumerate(errors, 1)
        ],
        "next_cursor": None,
    }

    files = {
        "projects.json": projects,
        "tasks_alpha.json": {"items": alpha_tasks, "next_cursor": None},
        "tasks_beta.json": {"items": beta_tasks, "next_cursor": None},
        "task_detail.json": detail,
        "reviews.json": {"items": [review_task], "next_cursor": None},
        "discoveries.json": {"items": [discovery], "next_cursor": None},
        "matrix.json": matrix,
        "telemetry.json": telemetry,
        "errors.json": error_payload,
    }
    for name, payload in files.items():
        (OUT / name).write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    with (OUT / "events.jsonl").open("w", encoding="utf-8", newline="\n") as fh:
        for event in events:
            fh.write(json.dumps(event, separators=(",", ":"), ensure_ascii=False) + "\n")
    print(f"wrote {len(files) + 1} fixture files to {OUT}")


if __name__ == "__main__":
    main()
