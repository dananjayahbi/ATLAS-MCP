"""Leases become advisory deadlines: add `lease_overdue_at`.

`lease_expires_at` used to be a hard cutoff whose breach re-queued the task.
It is now the agent's own *estimate*; passing it only stamps
`lease_overdue_at` and emits a WARN. The column is what the HUD reads to show
`OVERDUE`, and what a heartbeat clears when the agent reports in again.

The event-type choice list widens `task.lease_expired`'s label only — SQLite
stores the wire value, so the `AlterField` is a state-only change.
"""

import django.db.models.deletion  # noqa: F401  (kept for migration parity)

from django.db import migrations, models

EVENT_TYPES = [
    ("task.created", "Task created"),
    ("task.updated", "Task updated"),
    ("task.status_changed", "Task status changed"),
    ("task.priority_changed", "Task priority changed"),
    ("task.dod_updated", "Task DoD updated"),
    ("task.log", "Task log"),
    ("task.lease_expired", "Task lease overdue"),
    ("task.submitted", "Task submitted"),
    ("review.approved", "Review approved"),
    ("review.rejected", "Review rejected"),
    ("discovery.created", "Discovery created"),
    ("discovery.approved", "Discovery approved"),
    ("discovery.rejected", "Discovery rejected"),
    ("claim_limit.requested", "Claim limit requested"),
    ("claim_limit.resolved", "Claim limit resolved"),
    ("agent.connected", "Agent connected"),
    ("agent.heartbeat", "Agent heartbeat"),
    ("system.boot", "System boot"),
    ("system.recovery", "System recovery"),
    ("telemetry.tick", "Telemetry tick"),
]


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0003_operator_controls"),
    ]

    operations = [
        migrations.AddField(
            model_name="task",
            name="lease_overdue_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddIndex(
            model_name="task",
            index=models.Index(fields=["lease_overdue_at"], name="task_overdue_idx"),
        ),
        migrations.AlterField(
            model_name="taskevent",
            name="type",
            field=models.CharField(choices=EVENT_TYPES, max_length=32),
        ),
    ]
