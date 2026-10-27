"""Temporary verification script -- deleted after a successful run."""

from __future__ import annotations

import asyncio
import json
import os
import sys

import httpx

from mcp_server.client import AtlasClient
from mcp_server.config import load
from mcp_server.projections import ELLIPSIS, MAX_RESPONSE_BYTES, json_bytes, project_claimed_task
from mcp_server.schemas import CORE_CONTRACTS
from mcp_server.server import build
from mcp_server.tools import TOOL_NAMES

FAILS: list[str] = []


def check(cond: bool, label: str) -> None:
    print(("PASS " if cond else "FAIL ") + label)
    if not cond:
        FAILS.append(label)


# ---- 1. projection byte-size assertion ----------------------------------
FAKE_DETAIL = {
    "contract_version": "1.0.0",
    "task_id": "5f2d6c1e-1f0b-4c5b-9a2e-77d0d2f3c901",
    "project_id": "b3f1c0a4-7d21-4a6e-9f5c-2a1e8d6f0c11",
    "project_slug": "alpha",
    "title": "Fix JWT expiry race condition",
    "description": (
        "Refresh token rotation races the access-token check in auth/middleware.py. "
        "Reproduce with the 3-thread test, then guard rotation with a per-user mutex. " * 4
    ),
    "priority": 95,
    "status": "IN_PROGRESS",
    "created_at": "2026-10-26T04:40:00.000Z",
    "updated_at": "2026-10-27T08:05:00.000Z",
    "claimed_at": "2026-10-27T08:05:11.000Z",
    "lease_expires_at": "2026-10-27T08:20:11.000Z",
    "last_heartbeat_at": "2026-10-27T08:10:11.000Z",
    "lease_id": "lea_01JA2Y7Q0K3M9V2TAAAAAAAAAA",
    "attempt_count": 1,
    "assigned_agent_id": "Agent-Claude",
    "local_repo_path": "E:\\dev\\alpha",
    "project_rules": "Use pnpm. Tests: pytest -q.",
    "definition_of_done": [
        {"id": i, "label": f"Checklist item {i}", "completed": i % 2 == 0,
         "completed_at": None, "completed_by_agent": None}
        for i in range(1, 47)
    ],
    "assets": [
        {"id": f"0c7b1f{i:02d}", "kind": "ANNOTATED_CANVAS", "filename": f"img{i}.png",
         "mime_type": "image/png", "byte_size": 184320, "sha256": "9f2c" + "0" * 60,
         "source": "HUMAN", "absolute_path": f"E:\\storage\\tasks\\t\\input\\img{i}.png",
         "url": f"/api/v1/assets/0c7b{i}/content", "created_at": "2026-10-26T05:02:00.000Z"}
        for i in range(14)
    ],
    "recent_events": [{"id": f"evt_01JA2Y7Q0K3M9V2{i}", "seq": i, "type": "task.status_changed",
                       "level": "INFO", "message": "PENDING -> IN_PROGRESS",
                       "ts": "2026-10-27T08:05:11.000Z"} for i in range(50)],
}

proj = project_claimed_task(FAKE_DETAIL, None)
size = json_bytes(proj)
print(f"\nprojection bytes = {size} (limit {MAX_RESPONSE_BYTES})")
check(size <= MAX_RESPONSE_BYTES, f"projection <= 16384 bytes (got {size})")
check(len(proj["definition_of_done"]) == 40, "DoD capped at 40")
check(len(proj["attached_images"]) == 10, "images capped at 10")
forbidden = {"created_at", "updated_at", "claimed_at", "lease_expires_at", "recent_events",
             "assets", "project_id", "audit", "contract_version", "attempt_count"}
check(not (forbidden & set(proj)), f"no forbidden keys ({sorted(forbidden & set(proj))})")

worst = dict(FAKE_DETAIL)
worst["description"] = "D" * 40000
worst["project_rules"] = "R" * 5000
worst_proj = project_claimed_task(worst, None)
worst_size = json_bytes(worst_proj)
print(f"worst-case projection bytes = {worst_size}")
check(worst_size <= MAX_RESPONSE_BYTES, f"worst case <= 16384 bytes (got {worst_size})")
check(worst_proj["description"].endswith(ELLIPSIS), "worst case description signals truncation")
check(len(project_claimed_task(FAKE_DETAIL, None)["description"]) <= 8000, "description <= 8000")

empty = project_claimed_task({"task_id": None, "reason": "NO_ELIGIBLE_TASK"}, None)
check(empty == {"task_id": None, "reason": "NO_ELIGIBLE_TASK"}, "empty claim is exactly 2 keys")
check(project_claimed_task(proj, None) == proj, "projection is idempotent")
check(json_bytes(project_claimed_task(FAKE_DETAIL, None)) == size, "projection is byte-stable")

# ---- 2. schema fidelity + live tool calls -------------------------------
cfg = load(
    {
        "ATLAS_BACKEND_URL": "http://127.0.0.1:8000",
        "ATLAS_API_TOKEN": "a" * 24,
        "ATLAS_STORAGE_ROOT": os.path.abspath("storage"),
    },
    [],
)


class Recorder(httpx.BaseTransport):
    def __init__(self, responses: dict[str, tuple[int, dict]]):
        self.responses = responses
        self.requests: list[httpx.Request] = []

    def handle_request(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        status, body = self.responses.get(request.url.path, (200, {"ok": True}))
        return httpx.Response(status, json=body)


transport = Recorder(
    {
        "/internal/v1/claim": (200, dict(FAKE_DETAIL)),
        "/internal/v1/propose": (200, {"ok": True, "task_id": "8c14a7b0-2d33-4f18-9a61-0b7e5c9d4f22",
                                       "status": "PENDING_APPROVAL"}),
        "/internal/v1/submit": (200, {"ok": True, "status": "IN_REVIEW", "dod_progress_percent": 100}),
        "/internal/v1/progress": (200, {"ok": True}),
        "/internal/v1/heartbeat": (200, {"ok": True, "lease_expires_at": "2026-10-27T14:02:11.297Z",
                                         "seconds_remaining": 897}),
        "/internal/v1/dod": (200, {"ok": True, "dod_progress_percent": 100}),
        "/internal/v1/subtask": (200, {"ok": True, "task_id": "1c9d5e77-8b2a-4c31-a0f4-6d2e9b7c3a10",
                                       "status": "PENDING"}),
        "/internal/v1/task": (200, dict(FAKE_DETAIL)),
    }
)
client = AtlasClient(cfg, transport=transport)
mcp = build(cfg, client=client)

CALLS = {
    "claim_next_task": {"project_slug": "alpha", "agent_identifier": "Agent-Claude", "min_priority": 0},
    "propose_task": {"project_slug": "alpha", "title": "T", "description": "D", "suggested_priority": 85,
                     "discovered_during_task_id": "5f2d6c1e-1f0b-4c5b-9a2e-77d0d2f3c901",
                     "screenshot_paths": [os.path.abspath("storage/projects/x/tasks/y/output/a.png")]},
    "submit_for_review": {"task_id": "5f2d6c1e-1f0b-4c5b-9a2e-77d0d2f3c901",
                          "summary_of_work": "S",
                          "git_patch": "--- a/x\n+++ b/x\n@@ -1 +1 @@\n-old\n+new\n",
                          "verification_log": "pytest -q -> 148 passed"},
    "log_task_progress": {"task_id": "5f2d6c1e-1f0b-4c5b-9a2e-77d0d2f3c901", "message": "m", "level": "INFO"},
    "task_heartbeat": {"task_id": "5f2d6c1e-1f0b-4c5b-9a2e-77d0d2f3c901",
                       "lease_id": "lea_01JA2Y7Q0K3M9V2TAAAAAAAAAA"},
    "update_dod_item": {"task_id": "5f2d6c1e-1f0b-4c5b-9a2e-77d0d2f3c901", "item_id": 2, "completed": True},
    "spawn_subtask": {"parent_task_id": "5f2d6c1e-1f0b-4c5b-9a2e-77d0d2f3c901", "title": "T",
                      "description": "D", "priority": 40},
    "get_task_details": {"task_id": "5f2d6c1e-1f0b-4c5b-9a2e-77d0d2f3c901"},
}


async def run() -> None:
    listed = await mcp.list_tools()
    names = [t.name for t in listed]
    check(names == list(TOOL_NAMES), f"8 tools listed in frozen order: {names}")

    by_name = {t.name: t for t in listed}
    for tool_name, (params, _returns) in CORE_CONTRACTS.items():
        published = by_name[tool_name].input_schema
        check(set(published["properties"]) == set(params["properties"]),
              f"C1 {tool_name} property keys match")
        check(published.get("required") == params.get("required"),
              f"C2 {tool_name} required matches")
        mismatched = []
        for key, spec in params["properties"].items():
            got = published["properties"][key]
            for constraint in ("enum", "minimum", "maximum", "default"):
                if constraint in spec and got.get(constraint) != spec[constraint]:
                    mismatched.append((key, constraint, got.get(constraint), spec[constraint]))
        check(not mismatched, f"C3 {tool_name} bounds/enums match ({mismatched})")
        check(not set(published["properties"]) - set(params["properties"]),
              f"C4 {tool_name} has no stray parameter")

    for tool_name, call_args in CALLS.items():
        result = await mcp.call_tool(tool_name, call_args)
        text = result.content[0].text
        check(not result.is_error, f"{tool_name} isError=false")
        parsed = json.loads(text)
        check("error" not in parsed, f"{tool_name} returned no error envelope")
        check(len(text.encode("utf-8")) <= MAX_RESPONSE_BYTES,
              f"{tool_name} response <= 16384 B ({len(text.encode('utf-8'))} B)")
        check("data:" not in text, f"{tool_name} carries no data: URI")
        if tool_name == "log_task_progress":
            check(text == '{"ok":true}', f'log_task_progress is exactly {{"ok":true}} ({text!r})')

    # PATH_OUT_OF_SCOPE must cost zero HTTP calls
    before = len(transport.requests)
    bad = dict(CALLS["propose_task"])
    bad["screenshot_paths"] = ["E:\\Windows\\System32\\evil.png"]
    parsed = json.loads((await mcp.call_tool("propose_task", bad)).content[0].text)
    check(parsed.get("error", {}).get("code") == "PATH_OUT_OF_SCOPE",
          "propose out-of-root -> PATH_OUT_OF_SCOPE")
    check(len(transport.requests) == before, "PATH_OUT_OF_SCOPE issued zero HTTP calls")

    # validation errors come back as INVALID_ARGUMENT JSON bodies
    for label, tool_name, call_args in (
        ("bad level", "log_task_progress", {"task_id": "abc", "message": "m", "level": "TRACE"}),
        ("min_priority > 100", "claim_next_task",
         {"project_slug": "alpha", "agent_identifier": "Agent-C", "min_priority": 101}),
        ("missing git_patch marker", "submit_for_review",
         {"task_id": "t", "summary_of_work": "S", "git_patch": "just text"}),
        ("blank title", "propose_task",
         {"project_slug": "alpha", "title": "   ", "description": "D", "suggested_priority": 1,
          "discovered_during_task_id": "t"}),
        ("item_id 0", "update_dod_item", {"task_id": "t", "item_id": 0, "completed": True}),
        ("bad lease id", "task_heartbeat", {"task_id": "t", "lease_id": "nope"}),
        ("priority 200", "spawn_subtask",
         {"parent_task_id": "t", "title": "T", "description": "D", "priority": 200}),
        ("empty task_id", "get_task_details", {"task_id": ""}),
    ):
        result = await mcp.call_tool(tool_name, call_args)
        check(not result.is_error, f"{label}: isError=false")
        parsed = json.loads(result.content[0].text)
        check(parsed.get("error", {}).get("code") == "INVALID_ARGUMENT",
              f"{label} -> INVALID_ARGUMENT ({parsed.get('error', {}).get('code')})")

    # unknown key is a schema violation: the SDK rejects it before the handler
    try:
        result = await mcp.call_tool("get_task_details", {"task_id": "t", "bogus": 1})
    except Exception as exc:  # noqa: BLE001 - SDK raises ToolError at the boundary
        check("extra_forbidden" in str(exc) or "Extra inputs" in str(exc),
              f"unknown key is rejected by extra=forbid ({type(exc).__name__})")
    else:
        check(result.is_error or '"INVALID_ARGUMENT"' in result.content[0].text,
              "unknown key is rejected (extra=forbid)")


asyncio.run(run())

# ---- 3. retry policy / error mapping -----------------------------------
import mcp_server.client as client_module  # noqa: E402

original_delays = client_module.RETRY_DELAYS
client_module.RETRY_DELAYS = (0, 0)
try:
    t2 = Recorder({"/internal/v1/progress": (502, {"message": "down"})})
    mcp2 = build(cfg, client=AtlasClient(cfg, transport=t2))
    parsed = json.loads(asyncio.run(mcp2.call_tool("log_task_progress",
                                                   {"task_id": "t", "message": "m"})).content[0].text)
    check(len(t2.requests) == 3, f"502 retried exactly twice ({len(t2.requests)} attempts)")
    check(parsed["error"]["code"] == "BACKEND_UNAVAILABLE" and parsed["error"]["retryable"] is True,
          "502 -> BACKEND_UNAVAILABLE retryable=true")

    t3 = Recorder({"/internal/v1/claim": (503, {"message": "down"})})
    mcp3 = build(cfg, client=AtlasClient(cfg, transport=t3))
    asyncio.run(mcp3.call_tool("claim_next_task", {"project_slug": "alpha", "agent_identifier": "Agent-C"}))
    check(len(t3.requests) == 1, f"claim never retried ({len(t3.requests)} attempt, retries=0)")

    t3b = Recorder({"/internal/v1/subtask": (503, {"message": "down"})})
    mcp3b = build(cfg, client=AtlasClient(cfg, transport=t3b))
    asyncio.run(mcp3b.call_tool("spawn_subtask",
                                {"parent_task_id": "t", "title": "T", "description": "D", "priority": 1}))
    check(len(t3b.requests) == 1, f"subtask never retried ({len(t3b.requests)} attempt, retries=0)")

    t4 = Recorder({"/internal/v1/submit": (409, {"error": {"code": "STALE_LEASE",
                                                          "message": "lease expired"}})})
    mcp4 = build(cfg, client=AtlasClient(cfg, transport=t4))
    parsed = json.loads(asyncio.run(
        mcp4.call_tool("submit_for_review", CALLS["submit_for_review"])
    ).content[0].text)
    check(parsed["error"]["code"] == "LEASE_INVALID"
          and parsed["error"]["hint"] == "STOP_WORK_AND_RECLAIM",
          f"409 STALE_LEASE -> LEASE_INVALID + STOP_WORK_AND_RECLAIM ({parsed['error']['code']})")
    check(len(t4.requests) == 1, "409 never retried")

    t5 = Recorder({"/internal/v1/task": (404, {"error": {"code": "TASK_NOT_FOUND",
                                                         "message": "nope"}})})
    mcp5 = build(cfg, client=AtlasClient(cfg, transport=t5))
    parsed = json.loads(asyncio.run(
        mcp5.call_tool("get_task_details", {"task_id": "t"})
    ).content[0].text)
    check(parsed["error"]["code"] == "TASK_NOT_FOUND"
          and parsed["error"]["hint"] == "STOP_WORK_AND_RECLAIM",
          "404 TASK_NOT_FOUND -> STOP_WORK_AND_RECLAIM")

    t6 = Recorder({"/internal/v1/progress": (401, {"error": {"code": "AUTH_INVALID",
                                                             "message": "Bearer aaaaaaaa secret"}})})
    mcp6 = build(cfg, client=AtlasClient(cfg, transport=t6))
    text6 = asyncio.run(mcp6.call_tool("log_task_progress",
                                       {"task_id": "t", "message": "m"})).content[0].text
    check("aaaa" not in text6, f"401 body never leaks the token ({text6[:100]})")
    check(json.loads(text6)["error"]["code"] == "BACKEND_UNAVAILABLE", "401 -> BACKEND_UNAVAILABLE")
finally:
    client_module.RETRY_DELAYS = original_delays

# ---- 4. config validation ------------------------------------------------
from mcp_server.config import ConfigError  # noqa: E402

for label, env in (
    ("missing URL", {"ATLAS_API_TOKEN": "a" * 24}),
    ("missing token", {"ATLAS_BACKEND_URL": "http://127.0.0.1:8000"}),
    ("short token", {"ATLAS_BACKEND_URL": "http://127.0.0.1:8000", "ATLAS_API_TOKEN": "short"}),
    ("placeholder token", {"ATLAS_BACKEND_URL": "http://127.0.0.1:8000", "ATLAS_API_TOKEN": "dev"}),
    ("relative storage root", {"ATLAS_BACKEND_URL": "http://127.0.0.1:8000",
                               "ATLAS_API_TOKEN": "a" * 24, "ATLAS_STORAGE_ROOT": "storage"}),
    ("bad slug", {"ATLAS_BACKEND_URL": "http://127.0.0.1:8000", "ATLAS_API_TOKEN": "a" * 24,
                  "ATLAS_PROJECT_SLUG": "Alpha!"}),
    ("bad backend url", {"ATLAS_BACKEND_URL": "ftp://x", "ATLAS_API_TOKEN": "a" * 24}),
):
    try:
        load(env, [])
    except ConfigError as exc:
        check(True, f"config rejects {label}: {exc}")
    else:
        check(False, f"config rejects {label}")

good = load({"ATLAS_BACKEND_URL": "http://127.0.0.1:8000", "ATLAS_API_TOKEN": "a" * 24,
             "ATLAS_HEARTBEAT_INTERVAL_SECONDS": "600"}, [])
check(good.heartbeat_interval_seconds == 300,
      f"heartbeat clamped to ttl//3 ({good.heartbeat_interval_seconds})")
check("a" * 24 not in repr(good) and "a" * 24 not in str(good), "token absent from repr/str")
check(good.backend_url == "http://127.0.0.1:8000", "backend url has no trailing slash")
flag_cfg = load({"ATLAS_BACKEND_URL": "http://127.0.0.1:8000", "ATLAS_API_TOKEN": "a" * 24,
                 "ATLAS_PROJECT_SLUG": "alpha"}, ["--project", "beta", "--agent", "Agent-X"])
check(flag_cfg.project_slug == "beta" and flag_cfg.agent_id == "Agent-X", "--project/--agent beat env")

# ---- 5. path containment -------------------------------------------------
from mcp_server.errors import PathOutOfScope  # noqa: E402
from mcp_server.paths import assert_within_root, is_within_root, normalize_path  # noqa: E402

root = os.path.abspath("storage")
check(normalize_path("") == "", "normalize_path('') == ''")
check(is_within_root(os.path.join(root, "a", "b.png"), root), "inside-root path accepted")
check(not is_within_root(os.path.join(root, "..", "etc", "passwd"), root), "'..' escape rejected")
check(not is_within_root("E:\\Windows\\System32\\x.png", root), "drive escape rejected")
check(is_within_root(os.path.join(root, "not", "yet", "created.png"), root),
      "non-existent path inside root accepted")
try:
    assert_within_root("E:\\Windows\\x.png", root)
except PathOutOfScope as exc:
    check(exc.code == "PATH_OUT_OF_SCOPE" and exc.retryable is False, "assert_within_root raises typed error")
else:
    check(False, "assert_within_root raises typed error")
check(normalize_path(os.path.join(root, "a", "b.png")) == os.path.join(root, "a", "b.png"),
      "native separators preserved")

print("\n" + ("ALL CHECKS PASSED" if not FAILS else f"{len(FAILS)} FAILURES: {FAILS}"))
sys.exit(1 if FAILS else 0)
