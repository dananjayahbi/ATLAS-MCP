"""JSON renderer (Doc 01 §7.1).

`contract_version` is **not** auto-stamped here. Doc 01 §7.1 says responses
*may* include it, and only `ProjectDTO` (§7.2) actually shows it — so the
project serializer declares it explicitly. Auto-stamping every object would
pollute action payloads whose shapes are frozen (`{"ok": true}` per §9.5) and
break the "2 fields only" guarantee for `NO_ELIGIBLE_TASK` (§9.2).
"""

from __future__ import annotations

from django.conf import settings
from rest_framework.renderers import JSONRenderer

CONTRACT_VERSION = "1.0.0"


class AtlasJSONRenderer(JSONRenderer):
    """Plain JSON with a stable charset; shapes are owned by serializers."""

    charset = "utf-8"

    def render(self, data, accepted_media_type=None, renderer_context=None) -> bytes:
        return super().render(data, accepted_media_type, renderer_context)


def contract_version() -> str:
    return getattr(settings, "ATLAS_CONTRACT_VERSION", CONTRACT_VERSION)
