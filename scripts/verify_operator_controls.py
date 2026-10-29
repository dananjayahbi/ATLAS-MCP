"""End-to-end verification against a live, isolated ATLAS instance.

Runs every behaviour this change set introduced, through the real HTTP surface,
against a throwaway DB/storage root on a non-default port. It never touches the
operator's live data.

Usage (backend must already be running with a scratch ATLAS_DB_PATH):

    python scripts/verify_operator_controls.py --base http://127.0.0.1:8599 --token verify-token
"""

from __future__ import annotations

import argparse
import io
import json
import sys
import urllib.error
import urllib.request

RESULTS: list[tuple[str, bool, str]] = []


def check(name: str, passed: bool, detail: str = "") -> None:
    RESULTS.append((name, passed, detail))
    print(f"  {'PASS' if passed else 'FAIL'}  {name}" + (f"  [{detail}]" if detail else ""))


def request(base, token, method, path, *, body=None, agent=None, files=None):
    url = base.rstrip("/") + path
    headers = {"Authorization": f"Bearer {token}"}
    if agent:
        headers["X-ATLAS-Agent"] = agent
    data = None
    if files is not None:
        boundary = "----atlasverify"
        parts = []
        for name, value in files.get("fields", {}).items():
            parts.append(
                f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n"
            )
        for name, (filename, payload, mime) in files.get("files", {}).items():
            parts.append(
                f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"; "
                f"filename=\"{filename}\"\r\nContent-Type: {mime}\r\n\r\n"
            )
        prefix = "".join(parts).encode()
        suffix = f"\r\n--{boundary}--\r\n".encode()
        blob = bytearray(prefix)
        for _, (_, payload, _) in files.get("files", {}).items():
            blob += payload + b"\r\n"
        blob += suffix
        data = bytes(blob)
        headers["Content-Type"] = f"multipart/form-data; boundary={boundary}"
    elif body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"

    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=20) as response:
            raw = response.read()
            # Image routes answer with bytes, not JSON.
            if raw[:1] not in (b"{", b"[", b"n", b'"') and not raw[:4].isascii():
                return response.status, {"__bytes__": len(raw)}
            if raw and not raw[:1].isascii():
                return response.status, {"__bytes__": len(raw)}
            payload = json.loads(raw) if raw else None
            return response.status, payload
    except urllib.error.HTTPError as exc:
        raw = exc.read()
        try:
            return exc.code, json.loads(raw)
        except (ValueError, UnicodeDecodeError):
            return exc.code, raw.decode(errors="replace")


def png(width=900, height=700):
    from PIL import Image

    buffer = io.BytesIO()
    Image.new("RGB", (width, height), (10, 20, 30)).save(buffer, format="PNG")
    return buffer.getvalue()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://127.0.0.1:8599")
    parser.add_argument("--token", default="verify-token")
    parser.add_argument("--slug", default="verify-project")
    args = parser.parse_args()

    base, token, slug = args.base, args.token, args.slug
    agent = "Agent-Verify"

    print("== create project with an explicit claim limit ==")
    status, project = request(
        base, token, "POST", "/api/v1/projects/",
        body={
            "slug": slug,
            "name": "Verification Project",
            "local_repo_path": r"E:\dev\verify",
            "claim_limit": 2,
        },
    )
    check("project created", status == 201, str(status))
    check("claim_limit persisted", project.get("claim_limit") == 2, str(project.get("claim_limit")))
    check("claim_slots_used starts at 0", project.get("claim_slots_used") == 0)

    print("\n== create tasks ==")
    task_ids = []
    for title, priority in [
        ("Fix POS terminal receipt printing", 95),
        ("Fix POS terminal barcode scanner", 90),
        ("Upgrade the invoicing report", 60),
    ]:
        status, task = request(
            base, token, "POST", f"/api/v1/projects/{slug}/tasks/",
            body={
                "title": title,
                "description": f"{title} — verification task.",
                "priority": priority,
                "dod_items": ["Repro written", "Fix applied", "Tests pass"],
            },
        )
        check(f"task created: {title[:32]}", status == 201, str(status))
        task_ids.append(task["id"])

    print("\n== unlimited image upload ==")
    uploaded = []
    for index in range(7):
        status, asset = request(
            base, token, "POST", "/api/v1/assets/",
            files={
                "fields": {"task_id": task_ids[0], "kind": "INPUT_SCREENSHOT"},
                "files": {"file": (f"shot{index}.png", png(), "image/png")},
            },
        )
        if status == 201:
            uploaded.append(asset)
    check("7 images uploaded (old cap was 5)", len(uploaded) == 7, f"{len(uploaded)} accepted")
    check(
        "every asset has a thumbnail_url",
        all(a.get("thumbnail_url") for a in uploaded),
        f"{sum(1 for a in uploaded if a.get('thumbnail_url'))}/{len(uploaded)}",
    )
    if uploaded:
        thumb_status, _ = request(base, token, "GET", f"/api/v1/assets/{uploaded[0]['id']}/thumbnail")
        check("thumbnail route serves bytes", thumb_status == 200, str(thumb_status))
        full_status, _ = request(base, token, "GET", f"/api/v1/assets/{uploaded[0]['id']}/content")
        check("original content route still works", full_status == 200, str(full_status))

    status, previews = request(base, token, "GET", f"/api/v1/projects/{slug}/assets/?task_id={task_ids[0]}")
    images = (previews or {}).get("items", [{}])[0].get("images", [])
    check("task-scoped previews return every image", len(images) == 7, f"{len(images)} listed")
    check("previews carry thumbnail_url", all(i.get("thumbnail_url") for i in images))

    print("\n== claim limit ==")
    claimed = []
    for _ in range(2):
        status, body = request(
            base, token, "POST", "/internal/v1/claim",
            body={"project_slug": slug, "agent_identifier": agent}, agent=agent,
        )
        if status == 200 and body.get("task_id"):
            claimed.append(body)
    check("two claims granted at limit=2", len(claimed) == 2, f"{len(claimed)}")

    status, blocked = request(
        base, token, "POST", "/internal/v1/claim",
        body={"project_slug": slug, "agent_identifier": agent}, agent=agent,
    )
    check("third claim reports CLAIM_LIMIT_REACHED",
          blocked.get("reason") == "CLAIM_LIMIT_REACHED", str(blocked.get("reason")))
    check("limit payload carries the numbers",
          blocked.get("claim_limit") == 2 and blocked.get("in_progress") == 2,
          f"{blocked.get('claim_limit')}/{blocked.get('in_progress')}")
    check("hint points at request_claim_limit",
          "request_claim_limit" in (blocked.get("hint") or ""))

    print("\n== agent asks, cannot self-grant ==")
    status, ask = request(
        base, token, "POST", "/internal/v1/claim-limit",
        body={"project_slug": slug, "requested_limit": 6,
              "reason": "Six independent POS-terminal fixes are queued."},
        agent=agent,
    )
    check("request accepted", status == 200 and ask.get("status") == "PENDING", str(status))
    _, after_ask = request(base, token, "GET", f"/api/v1/projects/{slug}/")
    check("agent request did NOT change the limit", after_ask.get("claim_limit") == 2,
          str(after_ask.get("claim_limit")))

    _, pending = request(base, token, "GET", f"/api/v1/claim-limit-requests/?project_slug={slug}")
    check("request appears in the operator list",
          len(pending.get("items", [])) == 1, str(len(pending.get("items", []))))

    status, resolved = request(
        base, token, "POST", f"/api/v1/claim-limit-requests/{ask['request_id']}/resolve/",
        body={"approve": True, "note": "Independent modules."},
    )
    check("operator approval applied", status == 200 and resolved.get("status") == "APPROVED", str(status))
    _, after_approve = request(base, token, "GET", f"/api/v1/projects/{slug}/")
    check("limit raised to the approved value", after_approve.get("claim_limit") == 6,
          str(after_approve.get("claim_limit")))

    status, third = request(
        base, token, "POST", "/internal/v1/claim",
        body={"project_slug": slug, "agent_identifier": agent}, agent=agent,
    )
    check("claim succeeds again after the raise", bool(third.get("task_id")), str(status))
    if third.get("task_id"):
        claimed.append(third)

    print("\n== submit requires progress + 100% DoD ==")
    first = claimed[0]
    status, refused = request(
        base, token, "POST", "/internal/v1/submit",
        body={"task_id": first["task_id"], "summary_of_work": "done",
              "git_patch": "--- a\n+++ b\n"},
        agent=agent,
    )
    check("submit without progress is refused", status == 409, str(status))
    check("refusal names the progress precondition",
          (refused.get("error", {}).get("detail") or {}).get("field") == "progress",
          str((refused.get("error", {}).get("detail") or {}).get("field")))

    request(base, token, "POST", "/internal/v1/progress",
            body={"task_id": first["task_id"], "message": "reproduced the race", "level": "INFO"},
            agent=agent)
    status, incomplete = request(
        base, token, "POST", "/internal/v1/submit",
        body={"task_id": first["task_id"], "summary_of_work": "done",
              "git_patch": "--- a\n+++ b\n"},
        agent=agent,
    )
    check("submit below 100% DoD is refused", status == 409, str(status))
    check("refusal names the DoD precondition",
          (incomplete.get("error", {}).get("detail") or {}).get("field") == "definition_of_done",
          str((incomplete.get("error", {}).get("detail") or {}).get("field")))

    for item_id in (1, 2, 3):
        request(base, token, "POST", "/internal/v1/dod",
                body={"task_id": first["task_id"], "item_id": item_id, "completed": True},
                agent=agent)
    status, submitted = request(
        base, token, "POST", "/internal/v1/submit",
        body={"task_id": first["task_id"], "summary_of_work": "fixed",
              "git_patch": "--- a\n+++ b\n@@\n-x\n+y\n", "verification_log": "3 passed"},
        agent=agent,
    )
    check("submit succeeds at 100% with progress", status == 200, str(status))
    check("status is IN_REVIEW", submitted.get("status") == "IN_REVIEW", str(submitted.get("status")))
    check("dod_progress_percent is 100", submitted.get("dod_progress_percent") == 100,
          str(submitted.get("dod_progress_percent")))

    print("\n== search ==")
    status, found = request(
        base, token, "POST", "/internal/v1/tasks/search",
        body={"project_slug": slug, "q": "POS terminal", "limit": 10}, agent=agent,
    )
    check("search by phrase", status == 200 and found.get("count") == 2, str(found.get("count")))
    check("search rows are tiny (no description)",
          all("description" not in row for row in found.get("items", [])))
    status, in_progress_only = request(
        base, token, "POST", "/internal/v1/tasks/search",
        body={"project_slug": slug, "q": "POS terminal", "status": ["IN_PROGRESS"]}, agent=agent,
    )
    # One POS task was submitted above, the other is still held; the filter must
    # return only the held one, never the IN_REVIEW row.
    check("status filter narrows to IN_PROGRESS",
          status == 200 and in_progress_only.get("count") == 1
          and in_progress_only["items"][0]["status"] == "IN_PROGRESS",
          str([r["status"] for r in in_progress_only.get("items", [])]))
    status, none_pending = request(
        base, token, "POST", "/internal/v1/tasks/search",
        body={"project_slug": slug, "q": "POS terminal", "status": ["PENDING"]}, agent=agent,
    )
    # Both POS tasks are claimed by this point, so a PENDING filter must be empty.
    check("status filter excludes other statuses", none_pending.get("count") == 0,
          str(none_pending.get("count")))
    status, narrowed = request(
        base, token, "POST", "/internal/v1/tasks/search",
        body={"project_slug": slug, "q": "POS terminal", "limit": 1}, agent=agent,
    )
    check("search signals truncation", narrowed.get("truncated") is True, str(narrowed.get("truncated")))
    status, _ = request(
        base, token, "POST", "/internal/v1/tasks/search",
        body={"project_slug": slug, "status": ["BOGUS"]}, agent=agent,
    )
    check("unknown status is a 400", status == 400, str(status))

    print("\n== archive from any status, restore resets progress ==")
    target = task_ids[1]
    request(base, token, "POST", "/internal/v1/progress",
            body={"task_id": target, "message": "x"}, agent=agent)
    for item_id in (1, 2):
        request(base, token, "POST", "/internal/v1/dod",
                body={"task_id": target, "item_id": item_id, "completed": True}, agent=agent)

    status, archived = request(base, token, "POST", f"/api/v1/tasks/{target}/archive/",
                              body={"archived": True})
    check("archive accepted", status == 200, str(status))
    check("archived task is REJECTED with a stamp",
          archived.get("status") == "REJECTED" and archived.get("archived_at"),
          f"{archived.get('status')}/{bool(archived.get('archived_at'))}")

    status, other = request(base, token, "POST", f"/api/v1/tasks/{task_ids[2]}/archive/",
                            body={"archived": True})
    check("archive works from PENDING too", status == 200, str(status))

    status, restored = request(base, token, "POST", f"/api/v1/tasks/{target}/archive/",
                               body={"archived": False})
    check("restore accepted", status == 200, str(status))
    check("restore returns PENDING", restored.get("status") == "PENDING", str(restored.get("status")))
    check("restore resets progress to 0", restored.get("dod_progress_percent") == 0,
          str(restored.get("dod_progress_percent")))
    status, archived_list = request(base, token, "GET", f"/api/v1/projects/{slug}/tasks/?archived=1")
    check("archive list holds the still-archived task",
          len(archived_list.get("items", [])) == 1, str(len(archived_list.get("items", []))))

    failed = [name for name, ok, _ in RESULTS if not ok]
    print("\n" + "=" * 60)
    if failed:
        print(f"FAILED — {len(failed)} of {len(RESULTS)} checks: {failed}")
        return 1
    print(f"PASSED — {len(RESULTS)} checks")
    return 0


if __name__ == "__main__":
    sys.exit(main())
