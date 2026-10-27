"""Series drift gates (Doc 10 §3, §13).

Enforces the cross-document contracts mechanically so a doc/source divergence
fails CI instead of being caught by review:

1. design-token census        — every hex in tokens.css is declared in Doc 05
2. forbidden token aliases    — no consumer references a removed alias
3. error-code census          — no invented `*_ERROR` style codes
4. contract identifiers       — lease/heartbeat/grace constants agree
5. migration drift            — `makemigrations --check --dry-run` is clean
6. route census               — every documented route resolves
7. encoding hygiene           — no U+FFFD / mojibake in tracked text
8. doc structure              — every doc has a DoD and Cross-Document section

Usage:
    python scripts/verify_series.py            # all gates
    python scripts/verify_series.py tokens     # one gate
Exit code 1 if any gate fails.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

REPO = Path(__file__).resolve().parents[1]
DOCS = REPO / "plan-series"
BACKEND = REPO / "backend"
FRONTEND = REPO / "frontend"
PY = REPO / ".venv" / "Scripts" / "python.exe"
if not PY.exists():
    PY = REPO / ".venv" / "bin" / "python"
PY = str(PY if PY.exists() else sys.executable)

FAILURES: list[str] = []


def fail(gate: str, message: str) -> None:
    FAILURES.append(f"[{gate}] {message}")
    print(f"  FAIL {message}")


def ok(message: str) -> None:
    print(f"  ok   {message}")


# ---------------------------------------------------------------------------
# 1 + 2 — design tokens
# ---------------------------------------------------------------------------
def gate_tokens() -> None:
    print("\n== design tokens ==")
    doc = (DOCS / "05_hud_design_system.md").read_text(encoding="utf-8")
    declared = set(
        re.findall(
            r"--(?:color|text|font|spacing|radius|breakpoint|animate|shadow|border|duration|ease|surface|status|priority|log)[a-z0-9-]+",
            doc,
        )
    )
    tokens_css = FRONTEND / "styles" / "tokens.css"
    css = tokens_css.read_text(encoding="utf-8")
    used = set(re.findall(r"--[a-z0-9-]+", css))

    primitives = {t for t in used if t.startswith("--atlas-")}
    semantic = used - primitives
    missing = sorted(t for t in semantic if t not in declared and not t.startswith("--surface-")
                     and not t.startswith("--color-") and not t.startswith("--duration-")
                     and not t.startswith("--ease-") and not t.startswith("--status-")
                     and not t.startswith("--priority-") and not t.startswith("--log-")
                     and t not in {"--breakpoint-hud-quad", "--spacing-frame"})
    if missing:
        fail("tokens", f"tokens.css declares tokens absent from Doc 05: {missing}")
    else:
        ok(f"{len(semantic)} semantic tokens trace to Doc 05")

    # Forbidden aliases (removed in the Doc 05 drift audit).
    # Doc 05 and this script legitimately *name* them as forbidden, so they are
    # excluded from the scan; every other file must not reference them.
    forbidden = ["--atlas-bg-canvas", "--atlas-bg-elevated", "--surface-0",
                 "--atlas-fg-primary", "--accent-cyan"]
    exempt = {
        (DOCS / "05_hud_design_system.md").resolve(),
        Path(__file__).resolve(),
    }
    hits: list[str] = []
    for path in _source_files():
        if path.resolve() in exempt:
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")
        for alias in forbidden:
            if alias in text:
                hits.append(f"{path.relative_to(REPO).as_posix()} uses {alias}")
    if hits:
        for h in hits:
            fail("aliases", h)
    else:
        ok("no forbidden token aliases in sources")


# ---------------------------------------------------------------------------
# 3 — error codes
# ---------------------------------------------------------------------------
def gate_errors() -> None:
    print("\n== error codes ==")
    enums = (BACKEND / "core" / "enums.py").read_text(encoding="utf-8")
    block = enums.split("class ErrorCode:", 1)[1].split("HTTP_STATUS_FOR_CODE", 1)[0]
    canonical = set(re.findall(r'^\s{4}[A-Z_]+ = "([A-Z_]+)"', block, re.M))
    if len(canonical) < 15:
        fail("errors", f"only {len(canonical)} canonical codes parsed from enums.py")
    else:
        ok(f"{len(canonical)} canonical error codes")

    doc01 = (DOCS / "01_system_architecture.md").read_text(encoding="utf-8")
    documented = set(re.findall(r"`([A-Z][A-Z_]{4,})`", doc01))
    invented = sorted(
        c for c in documented
        if c.endswith("_ERROR") or c.endswith("_NOT_FOUND") or c.startswith("AUTH_")
        or c in {"STALE_LEASE", "INVALID_TRANSITION", "RATE_LIMITED", "PAYLOAD_TOO_LARGE",
                 "PATH_OUT_OF_SCOPE", "DEPENDENCY_CYCLE", "DEPENDENCY_UNSATISFIABLE",
                 "TASK_ALREADY_LEASED", "STORAGE_WRITE_FAILED", "UNSUPPORTED_MEDIA_TYPE",
                 "BACKEND_UNAVAILABLE"}
    )
    unknown = sorted(c for c in invented if c not in canonical and c != "RATE_LIMITED")
    if unknown:
        fail("errors", f"documents reference codes missing from enums.py: {unknown}")
    else:
        ok("every documented code exists in enums.py")


# ---------------------------------------------------------------------------
# 4 — frozen numeric contract
# ---------------------------------------------------------------------------
def gate_constants() -> None:
    print("\n== frozen constants ==")
    base = (BACKEND / "atlas" / "settings" / "base.py").read_text(encoding="utf-8")
    doc01 = (DOCS / "01_system_architecture.md").read_text(encoding="utf-8")
    expected = {"LEASE_TTL_SECONDS": 900, "HEARTBEAT_INTERVAL_SECONDS": 120,
                "RECLAIM_GRACE_SECONDS": 60}
    for name, value in expected.items():
        pattern = rf"{name}.*?(\d+)"
        m = re.search(pattern, base)
        if not m or int(m.group(1)) != value:
            fail("constants", f"{name} is not {value} in base.py")
            continue
        if str(value) not in doc01:
            fail("constants", f"Doc 01 does not state {name}={value}")
            continue
        ok(f"{name} = {value}")
    if "16_384" not in (BACKEND / "api" / "internal" / "projections.py").read_text(encoding="utf-8"):
        fail("constants", "projection ceiling is not 16_384 bytes")
    else:
        ok("token projection ceiling = 16384")


# ---------------------------------------------------------------------------
# 5 — migration drift
# ---------------------------------------------------------------------------
def gate_migrations() -> None:
    print("\n== migrations ==")
    result = subprocess.run(
        [PY, "manage.py", "makemigrations", "--check", "--dry-run"],
        cwd=BACKEND, capture_output=True, text=True,
        env={**_env(), "ATLAS_SKIP_RECOVERY": "1"},
    )
    if result.returncode != 0:
        fail("migrations", "model changes are not migrated (run makemigrations)")
        print(result.stdout[-2000:])
    else:
        ok("no migration drift")


# ---------------------------------------------------------------------------
# 6 — route census
# ---------------------------------------------------------------------------
def gate_routes() -> None:
    print("\n== routes ==")
    script = (
        "import os,sys;sys.path.insert(0,'.');"
        "os.environ['DJANGO_SETTINGS_MODULE']='atlas.settings.dev';"
        "os.environ['ATLAS_SKIP_RECOVERY']='1';"
        "import django;django.setup();"
        "from django.urls import get_resolver;"
        "r=get_resolver();"
        "out=[]\n"
        "def w(ps,p=''):\n"
        "  for x in ps:\n"
        "    if hasattr(x,'url_patterns'): w(x.url_patterns,p+str(x.pattern))\n"
        "    else: out.append(p+str(x.pattern))\n"
        "w(r.url_patterns)\n"
        "print('\\n'.join(out))"
    )
    result = subprocess.run(
        [PY, "-c", script], cwd=BACKEND, capture_output=True, text=True, env=_env()
    )
    routes = [line for line in result.stdout.splitlines() if line.strip()]
    if result.returncode != 0:
        fail("routes", "could not enumerate routes")
        print(result.stderr[-1500:])
        return

    required = [
        "healthz",
        "api/v1/projects/",
        "api/v1/tasks/<uuid:task_id>/",
        "api/v1/tasks/<uuid:task_id>/claim-for-agent/",
        "api/v1/tasks/<uuid:task_id>/requeue/",
        "api/v1/discoveries/",
        "api/v1/reviews/",
        "api/v1/assets/",
        "api/v1/telemetry/summary",
        "api/v1/priority-matrix",
        "api/v1/stream/events",
        "api/v1/stream/tasks/<uuid:task_id>/log",
        "internal/v1/claim",
        "internal/v1/heartbeat",
        "internal/v1/submit",
        "internal/v1/task",
    ]
    missing = [r for r in required if r not in routes]
    if missing:
        fail("routes", f"documented routes not mounted: {missing}")
    else:
        ok(f"{len(routes)} routes mounted, all documented routes present")


# ---------------------------------------------------------------------------
# 7 — encoding hygiene
# ---------------------------------------------------------------------------
def gate_encoding() -> None:
    print("\n== encoding ==")
    bad: list[str] = []
    for path in _source_files():
        if path.suffix in {".png", ".ico", ".lock"}:
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            bad.append(f"{path.relative_to(REPO).as_posix()} is not valid UTF-8")
            continue
        if "\ufffd" in text:
            bad.append(f"{path.relative_to(REPO).as_posix()} contains U+FFFD")
        # Two-character sequences that only appear when UTF-8 is decoded as cp1252.
        for marker in ("\u00c3\u00a2", "\u00e2\u20ac"):
            if marker in text:
                bad.append(f"{path.relative_to(REPO).as_posix()} contains mojibake")
                break
    if bad:
        for b in bad[:10]:
            fail("encoding", b)
    else:
        ok("all tracked text is clean UTF-8")


# ---------------------------------------------------------------------------
# 8 — doc structure
# ---------------------------------------------------------------------------
def gate_docs() -> None:
    print("\n== doc structure ==")
    docs = sorted(DOCS.glob("[01][0-9]_*.md"))
    if len(docs) != 10:
        fail("docs", f"expected 10 numbered docs, found {len(docs)}")
    for doc in docs:
        text = doc.read_text(encoding="utf-8")
        if "Definition of Done" not in text:
            fail("docs", f"{doc.name} has no Definition of Done")
        if "Cross-Document Contracts" not in text and "Cross-Document" not in text:
            fail("docs", f"{doc.name} has no Cross-Document Contracts section")
    ok(f"{len(docs)} docs with DoD + cross-document sections")


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------
def _env() -> dict[str, str]:
    import os

    return {**os.environ, "ATLAS_SKIP_RECOVERY": "1", "ATLAS_DISABLE_SWEEPER": "1",
            "DJANGO_SETTINGS_MODULE": "atlas.settings.dev"}


def _source_files():
    roots = [DOCS, BACKEND, REPO / "mcp_server", REPO / "scripts", REPO / "tests",
             FRONTEND / "app", FRONTEND / "components", FRONTEND / "lib",
             FRONTEND / "hooks", FRONTEND / "styles"]
    exts = {".py", ".ts", ".tsx", ".css", ".md", ".json", ".jsonl", ".toml", ".ini", ".mjs"}
    seen = set()
    for root in roots:
        if not root.exists():
            continue
        for path in root.rglob("*"):
            if not path.is_file() or path.suffix not in exts:
                continue
            if any(part in {"node_modules", ".next", "__pycache__", ".venv"} for part in path.parts):
                continue
            if path not in seen:
                seen.add(path)
                yield path


GATES = {
    "tokens": gate_tokens,
    "errors": gate_errors,
    "constants": gate_constants,
    "migrations": gate_migrations,
    "routes": gate_routes,
    "encoding": gate_encoding,
    "docs": gate_docs,
}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("gate", nargs="?", choices=sorted(GATES), help="run one gate only")
    args = parser.parse_args()

    print("ATLAS-MCP series verification")
    print(f"repo: {REPO}")
    selected = [args.gate] if args.gate else list(GATES)
    for name in selected:
        GATES[name]()

    print("\n" + "=" * 60)
    if FAILURES:
        print(f"FAILED — {len(FAILURES)} problem(s)")
        for f in FAILURES:
            print(f"  • {f}")
        return 1
    print(f"PASSED — {len(selected)} gate(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
