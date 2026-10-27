#!/usr/bin/env python
"""Django management entry point (Doc 01 §4)."""

import os
import sys


def main() -> None:
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "atlas.settings.dev")
    try:
        from django.core.management import execute_from_command_line
    except ImportError as exc:  # pragma: no cover
        raise ImportError(
            "Couldn't import Django. Activate the project virtualenv first."
        ) from exc
    execute_from_command_line(sys.argv)


if __name__ == "__main__":
    main()
