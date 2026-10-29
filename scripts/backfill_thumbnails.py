"""Backfill image thumbnails for assets stored before thumbnails existed.

Uploads after this change generate a downscaled sibling automatically. Assets
written earlier have an empty `thumbnail_relative_path` and would keep serving
full-size bytes to the board, so run this once after deploying the change (and
again if the thumbnail size/format constants are ever tuned).

Idempotent: only rows with an empty path are touched, non-images are skipped,
and a row that fails to decode is left alone rather than being re-attempted.

Usage:
    python scripts/backfill_thumbnails.py [--dry-run]
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="report without writing")
    args = parser.parse_args()

    sys.path.insert(0, str(REPO / "backend"))
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "atlas.settings.dev")
    import django

    django.setup()

    from core.models import Asset
    from core.services.assets import refresh_thumbnail

    pending = Asset.objects.filter(thumbnail_relative_path="")
    total = pending.count()
    print(f"{total} asset(s) without a thumbnail")

    generated = skipped = failed = 0
    for asset in pending.iterator():
        if not asset.mime_type.startswith("image/"):
            skipped += 1
            continue
        if args.dry_run:
            print(f"  would generate: {asset.filename} ({asset.mime_type})")
            generated += 1
            continue
        try:
            refresh_thumbnail(asset)
        except Exception as exc:  # noqa: BLE001 - one bad file must not stop the sweep
            failed += 1
            print(f"  failed: {asset.filename}: {exc}")
            continue
        if asset.thumbnail_relative_path:
            generated += 1
        else:
            skipped += 1

    verb = "would generate" if args.dry_run else "generated"
    print(f"{verb}={generated} skipped={skipped} failed={failed}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
