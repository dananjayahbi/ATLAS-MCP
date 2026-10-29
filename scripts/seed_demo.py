"""Seed a realistic demo project so the HUD has something to render.

Mirrors the fixture pack shapes from Doc 01 §16 but goes through the real
service layer, so it also exercises scaffolding, events and audit writes.

Usage:  python scripts/seed_demo.py [--reset]
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "backend"))

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "atlas.settings.dev")
os.environ.setdefault("ATLAS_SKIP_RECOVERY", "1")
os.environ.setdefault("ATLAS_DISABLE_SWEEPER", "1")

import django  # noqa: E402

django.setup()

from core.enums import TaskStatus  # noqa: E402
from core.models import Project, Task  # noqa: E402
from core.services import tasks as svc  # noqa: E402

ALPHA_TASKS = [
    ("Fix JWT expiry race condition", 95, ["Repro test written", "Mutex guard added", "Migrations added"]),
    ("Replace deprecated auth middleware", 88, ["Audit call sites", "Swap API", "Update tests", "Remove shim"]),
    ("Add WAL checkpoint telemetry", 72, ["Metric defined", "Emitted", "Dashboarded"]),
    ("Harden asset upload MIME sniffing", 84, ["Sniff bytes", "Allow-list", "413 on oversize"]),
    ("Priority matrix empty-state copy", 41, ["Copy drafted", "Wired in"]),
    ("Lease sweep interval configurable", 48, ["Config parsed", "Docs updated"]),
    ("Agent heartbeat jitter tolerance", 100, ["Grace window", "Test added", "Docs updated"]),
]

BETA_TASKS = [
    ("Sync fixture pack with schema", 70, ["Diffed", "Updated"]),
    ("Add request-id correlation header", 76, ["Middleware", "Propagated", "Logged"]),
    ("Cursor pagination tie-break", 52, ["Tie-break", "Test"]),
    ("HUD density toggle", 35, ["Token", "Toggle", "Persist"]),
]


def _complete_checklist(task, *, agent: str) -> None:
    """Tick every DoD item, as an agent finishing the work would.

    `submit_for_review` refuses to move a task to `IN_REVIEW` below 100 %, so the
    demo data has to be produced through the same gate a real agent meets.
    """
    from core.models import ChecklistItem

    for item in ChecklistItem.objects.filter(task=task).order_by("order_index"):
        svc.update_dod_item(
            task_id=task.pk,
            item_id=item.order_index,
            completed=True,
            agent_identifier=agent,
        )


def seed() -> None:
    if Project.objects.filter(slug="alpha").exists():
        print("· demo data already present; nothing to do")
        return

    alpha = svc.get_project  # keep import used
    from core.services.projects import create_project

    project = create_project(
        slug="alpha",
        name="Alpha Backend",
        local_repo_path=r"E:\dev\alpha",
        global_rules_md="Use pnpm. Tests: `pytest -q`. Never touch `legacy/`.",
        accent_color="#00F2FE",
    )

    created: list[Task] = []
    for title, priority, dod in ALPHA_TASKS:
        created.append(
            svc.create_task(
                project_slug=project.slug,
                title=title,
                description=f"## {title}\n\nSeeded demo task.",
                priority=priority,
                dod_items=dod,
            )
        )

    # A dependency edge: the deprecation swap waits for the JWT fix.
    svc.set_blockers(task_id=created[1].pk, blocked_by_ids=[str(created[0].pk)])

    # Lifecycle variety so every board column has content.
    from core import leases

    claimed = leases.claim_next_task(project_slug="alpha", agent_identifier="Agent-Claude")
    if isinstance(claimed, leases.ClaimResult):
        svc.update_dod_item(
            task_id=claimed.task.pk,
            item_id=1,
            completed=True,
            agent_identifier="Agent-Claude",
        )
        svc.update_dod_item(
            task_id=claimed.task.pk,
            item_id=2,
            completed=True,
            agent_identifier="Agent-Claude",
        )
        svc.log_progress(
            task_id=claimed.task.pk,
            message="running: pytest tests/auth -k race",
            level="INFO",
        )

    # One IN_REVIEW task: claim it properly so the lease guard is satisfied, log
    # progress and finish the DoD — both are now preconditions of `IN_REVIEW`.
    review_target = created[3]
    leases.claim_specific_task(
        task_id=review_target.pk, agent_identifier="Agent-Claude"
    )
    svc.log_progress(
        task_id=review_target.pk,
        message="probing the upload endpoint with mismatched magic bytes",
        level="INFO",
    )
    _complete_checklist(review_target, agent="Agent-Claude")
    svc.submit_for_review(
        task_id=review_target.pk,
        summary_of_work="Byte-sniffing plus an allow-list.",
        git_patch="--- a/api/v1/views/assets.py\n+++ b/api/v1/views/assets.py\n@@\n-old\n+new\n",
        verification_log="4 passed",
        agent_identifier="Agent-Claude",
    )

    # One COMPLETED task.
    completed = created[5]
    leases.claim_specific_task(
        task_id=completed.pk, agent_identifier="Agent-Copilot"
    )
    svc.log_progress(
        task_id=completed.pk,
        message="making the reclaim sweep interval configurable",
        level="INFO",
    )
    _complete_checklist(completed, agent="Agent-Copilot")
    svc.submit_for_review(
        task_id=completed.pk,
        summary_of_work="Sweep interval is configurable.",
        git_patch="--- a/core/recovery.py\n+++ b/core/recovery.py\n@@\n-old\n+new\n",
        agent_identifier="Agent-Copilot",
    )
    svc.approve_review(task_id=completed.pk, note="Ship it.")

    # Two discoveries awaiting triage.
    svc.propose_task(
        project_slug=project.slug,
        title="Discovery triage keyboard shortcuts",
        description="j/k move the highlight but a/r never fire.",
        suggested_priority=85,
        discovered_during_task_id=str(created[0].pk),
        discovered_by_agent="Agent-Claude",
        discovery_reason="Observed while running keyboard.spec.ts.",
    )
    svc.propose_task(
        project_slug=project.slug,
        title="Migrate canvas autosave to IndexedDB",
        description="localStorage hits its 5 MB quota on large canvases.",
        suggested_priority=63,
        discovered_during_task_id=str(created[0].pk),
        discovered_by_agent="Agent-Copilot",
        discovery_reason="QuotaExceededError in the console during export.",
    )

    # A second project so the switcher and matrix have range.
    beta = create_project(
        slug="beta",
        name="Beta Dashboard",
        local_repo_path=r"E:\dev\beta",
        global_rules_md="Next 15 App Router. No new deps without an ADR.",
        accent_color="#F59E0B",
    )
    for title, priority, dod in BETA_TASKS:
        svc.create_task(
            project_slug=beta.slug,
            title=title,
            description=f"## {title}\n\nSeeded demo task.",
            priority=priority,
            dod_items=dod,
        )

    print(f"✓ seeded {Task.objects.count()} tasks across 2 projects")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reset", action="store_true")
    args = parser.parse_args()
    if args.reset:
        from django.db import connection

        with connection.cursor() as cursor:
            cursor.execute("DELETE FROM core_taskevent")
            cursor.execute("DELETE FROM core_asset")
            cursor.execute("DELETE FROM core_checklistitem")
            cursor.execute("DELETE FROM core_task_blocked_by")
            cursor.execute("DELETE FROM core_task")
            cursor.execute("DELETE FROM core_project")
        print("✓ cleared demo data")
    seed()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
