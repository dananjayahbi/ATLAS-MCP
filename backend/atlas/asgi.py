"""ASGI entry point.

The SSE endpoints are long-lived streaming responses, so ASGI is the primary
transport for anything involving `/api/v1/stream/*` (Doc 09 §1.2).
"""

import os

from django.core.asgi import get_asgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "atlas.settings.dev")

application = get_asgi_application()
