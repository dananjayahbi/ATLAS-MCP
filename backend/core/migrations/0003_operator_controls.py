# Generated manually for the operator-controls series.

import django.db.models.deletion
import uuid

from django.db import migrations, models

EVENT_TYPES = [
    ("task.created", "Task created"),
    ("task.updated", "Task updated"),
    ("task.status_changed", "Task status changed"),
    ("task.priority_changed", "Task priority changed"),
    ("task.dod_updated", "Task DoD updated"),
    ("task.log", "Task log"),
    ("task.lease_expired", "Task lease expired"),
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
        ("core", "0002_task_archived_at"),
    ]

    operations = [
        migrations.AddField(
            model_name="project",
            name="claim_limit",
            field=models.PositiveSmallIntegerField(default=5),
        ),
        migrations.AddField(
            model_name="asset",
            name="thumbnail_relative_path",
            field=models.CharField(blank=True, default="", max_length=1024),
        ),
        # The new event types widen the `TaskEvent.type` choices; SQLite stores
        # them as plain text, so this is a state-only change.
        migrations.AlterField(
            model_name="taskevent",
            name="type",
            field=models.CharField(choices=EVENT_TYPES, max_length=32),
        ),
        migrations.CreateModel(
            name="ClaimLimitRequest",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4,
                        editable=False,
                        primary_key=True,
                        serialize=False,
                    ),
                ),
                ("requested_by_agent", models.CharField(max_length=120)),
                ("current_limit", models.PositiveSmallIntegerField()),
                ("requested_limit", models.PositiveSmallIntegerField()),
                ("reason", models.TextField(blank=True, default="")),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("PENDING", "Pending"),
                            ("APPROVED", "Approved"),
                            ("DISMISSED", "Dismissed"),
                        ],
                        default="PENDING",
                        max_length=16,
                    ),
                ),
                ("resolved_by", models.CharField(blank=True, default="", max_length=120)),
                ("resolution_note", models.TextField(blank=True, default="")),
                ("resolved_at", models.DateTimeField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "project",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="claim_limit_requests",
                        to="core.project",
                    ),
                ),
            ],
            options={
                "db_table": "core_claimlimitrequest",
                "ordering": ["-created_at"],
                "indexes": [
                    models.Index(
                        fields=["project", "status"], name="claimreq_project_idx"
                    )
                ],
                "constraints": [
                    models.CheckConstraint(
                        check=models.Q(requested_limit__gte=1),
                        name="claimreq_limit_min",
                    )
                ],
            },
        ),
    ]
