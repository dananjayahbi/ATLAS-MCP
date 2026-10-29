# Doc 04 — Django Core REST & Triage API

> **Series position:** 04 of 10 · **Owner:** Subagent 4 (API Developer)
> **Consumes:** Doc 01 §7 (DTOs), §8 (transitions), §10 (internal RPC), §12 (route index), §15 (errors); Doc 02 (models, storage); Doc 03 (leases)
> **Publishes to:** Doc 06 (all browser data), Doc 08 (the `/internal/v1` routes MCP calls), Doc 10 (API test matrix)
> **Owned paths:** `backend/api/**` (except `sse.py`, owned by Doc 09), `backend/atlas/urls.py`

---

## 1. Scope & Boundary

Doc 04 defines every HTTP surface in the backend: the human/UI surface (`/api/v1/*`) and the agent RPC surface (`/internal/v1/*`). SSE streaming bodies live in Doc 09 (`api/sse.py`); this doc owns the route registration and the initial-response contract only.

| Owned | Not owned |
| :--- | :--- |
| `api/v1/**`, `api/internal/**`, `api/common/**`, `atlas/urls.py` | `api/sse.py` (Doc 09) |
| Serializers, filters, pagination, error rendering | Model definitions (Doc 02) |
| Route-level auth & throttling | Claim/heartbeat algorithms (Doc 03) |

**Layering rule:** views orchestrate only. They may call `core/services/*` and `core/leases.py`; they must never contain business rules, raw SQL, or filesystem writes.

```
view  →  serializer (validation/shape)  →  service (rules/transactions)  →  model
```

---

## 2. URL Map

```python
# backend/atlas/urls.py
urlpatterns = [
    path("admin/", admin.site.urls),
    path("healthz", health.HealthView.as_view()),                 # no auth (Doc 03 §5.4)
    path("api/v1/", include("api.v1.urls")),                      # human + browser
    path("internal/v1/", include("api.internal.urls")),           # agent RPC
]
```

### 2.1 `/api/v1/` routes

| Method | Path | View | Purpose |
| :--- | :--- | :--- | :--- |
| GET | `/projects/` | `ProjectListCreate` | List projects + counters |
| POST | `/projects/` | `ProjectListCreate` | Create project (scaffolds storage) |
| GET | `/projects/{slug}/` | `ProjectDetail` | Detail |
| PATCH | `/projects/{slug}/` | `ProjectDetail` | Rename / rules / accent / archive |
| GET | `/projects/{slug}/tasks/` | `TaskListCreate` | Board list (filters + pagination) |
| POST | `/projects/{slug}/tasks/` | `TaskListCreate` | Create task (+ DoD) |
| GET | `/tasks/{task_id}/` | `TaskDetail` | Full detail DTO |
| PATCH | `/tasks/{task_id}/` | `TaskDetail` | Title / description / priority / blocked_by / DoD replace |
| PATCH | `/tasks/{task_id}/priority/` | `TaskPriority` | Priority slider (0–100) |
| PATCH | `/tasks/{task_id}/status/` | `TaskStatus` | Operator status override (guard table §8, Doc 01) |
| PATCH | `/tasks/{task_id}/assignee/` | `TaskAssignee` | Relabel the owner of an unleased task |
| DELETE | `/tasks/{task_id}/` | `TaskDetail` | Hard delete while untouched; `409` once claimed |
| PATCH | `/tasks/{task_id}/dod/{item_id}/` | `TaskDodItem` | Toggle a checklist item |
| POST | `/tasks/{task_id}/force-release/` | `TaskForceRelease` | Reclaim from a wedged agent (T11) |
| POST | `/tasks/{task_id}/requeue/` | `TaskRequeue` | `REJECTED` → `PENDING` (T13) |
| POST | `/tasks/{task_id}/claim-for-agent/` | `TaskClaimForAgent` | Assign one specific task to a named agent (T14); sole emitter of `TASK_ALREADY_LEASED` |
| GET | `/tasks/{task_id}/events/` | `TaskEventList` | Paginated event history |
| GET | `/discoveries/` | `DiscoveryList` | `PENDING_APPROVAL` inbox |
| POST | `/discoveries/{task_id}/approve/` | `DiscoveryApprove` | T3 |
| POST | `/discoveries/{task_id}/reject/` | `DiscoveryReject` | T4 |
| GET | `/reviews/` | `ReviewList` | `IN_REVIEW` queue |
| POST | `/reviews/{task_id}/approve/` | `ReviewApprove` | T8 |
| POST | `/reviews/{task_id}/reject/` | `ReviewReject` | T9 |
| POST | `/assets/` | `AssetUpload` | Multipart upload (Doc 02 §10) |
| GET | `/assets/{asset_id}/content` | `AssetContent` | Inline bytes (images) |
| GET | `/assets/{asset_id}/download` | `AssetContent` | `Content-Disposition: attachment` |
| GET | `/assets/{asset_id}/annotation/` | `AssetAnnotation` | Stored stroke side-car for a screenshot |
| POST | `/assets/{asset_id}/annotation/` | `AssetAnnotation` | Burn-in: flattened PNG + stroke document |
| GET | `/projects/{slug}/assets/` | `ProjectAssetPreview` | Board thumbnails: ≤ 3 images per task |
| GET | `/telemetry/summary` | `TelemetrySummary` | HUD header numbers |
| GET | `/priority-matrix` | `PriorityMatrix` | Scatter points (`?x=age_hours\|dependency_weight`) |
| GET | `/stream/events` | `sse.project_events` | Doc 09 |
| GET | `/stream/tasks/{task_id}/log` | `sse.task_log` | Doc 09 |

### 2.2 `/internal/v1/` routes (agent RPC — Doc 01 §10)

| Method | Path | View | Maps to MCP tool |
| :--- | :--- | :--- | :--- |
| POST | `/claim` | `InternalClaim` | `claim_next_task` |
| POST | `/heartbeat` | `InternalHeartbeat` | `task_heartbeat` |
| POST | `/progress` | `InternalProgress` | `log_task_progress` |
| POST | `/dod` | `InternalDod` | `update_dod_item` |
| POST | `/submit` | `InternalSubmit` | `submit_for_review` |
| POST | `/propose` | `InternalPropose` | `propose_task` |
| POST | `/subtask` | `InternalSubtask` | `spawn_subtask` |
| POST | `/task` | `InternalTask` | `get_task_details` |

All internal routes are `POST`, `Allow: POST`, `OPTIONS` disabled. No browsable API renderer on this router (`renderer_classes = [JSONRenderer]`) — this is a machine surface.

---

## 3. Common Infrastructure (`api/common/`)

### 3.1 Authentication (`auth.py`)

```python
class BearerTokenAuthentication(BaseAuthentication):
    """Constant-time bearer check for both surfaces. Browser traffic arrives via the
    Next.js server rewrite, so the token never reaches client JS (Doc 01 §14.2)."""
    def authenticate(self, request):
        header = request.headers.get("Authorization", "")
        scheme, _, token = header.partition(" ")
        if scheme.lower() != "bearer" or not token:
            raise NotAuthenticated(code="AUTH_MISSING")
        if not secrets.compare_digest(token, settings.ATLAS_API_TOKEN):
            raise NotAuthenticated(code="AUTH_INVALID")
        return (AnonymousUser(), token)
```

| Surface | Auth | Extra |
| :--- | :--- | :--- |
| `/api/v1/*` | Bearer | CORS limited to `ATLAS_WEB_ORIGIN` |
| `/internal/v1/*` | Bearer + `X-ATLAS-Agent` header required | Throttled per agent id |
| `/healthz` | none | Payload contains no secrets |

**Loopback guard:** a middleware rejects requests whose `REMOTE_ADDR` is not loopback when `ATLAS_ENV=dev` (defence in depth if someone binds `0.0.0.0` by accident).

### 3.2 Error rendering (`errors.py`)

One exception handler produces the §7.8 envelope for **every** error path — DRF validation, custom domain errors, and unhandled exceptions:

```python
DOMAIN_STATUS = {
    "VALIDATION_ERROR": 400, "PATH_OUT_OF_SCOPE": 400,
    "AUTH_MISSING": 401, "AUTH_INVALID": 401,
    "PROJECT_NOT_FOUND": 404, "TASK_NOT_FOUND": 404, "ASSET_NOT_FOUND": 404,
    "INVALID_TRANSITION": 409, "TASK_ALREADY_LEASED": 409, "STALE_LEASE": 409,
    "DEPENDENCY_CYCLE": 409, "DEPENDENCY_UNSATISFIABLE": 409,
    "PAYLOAD_TOO_LARGE": 413, "UNSUPPORTED_MEDIA_TYPE": 415,
    "RATE_LIMITED": 429, "BACKEND_UNAVAILABLE": 502,
    "STORAGE_WRITE_FAILED": 507, "INTERNAL_ERROR": 500,
}
```

Rules:

1. `request_id` is generated (`req_<ULID>`) in middleware, echoed in the body **and** the `X-Request-ID` header, and included in every log line.
2. Domain exceptions carry `code`, `detail`, `retryable`; the handler never leaks a traceback.
3. DRF `ValidationError` is flattened into `code="VALIDATION_ERROR"` with `detail = {field: [messages]}`.
4. Unhandled exceptions log with `logger.exception` and return `INTERNAL_ERROR` (Doc 01 §15).

### 3.3 Pagination (`pagination.py`)

Cursor-based, opaque base64 of `(created_at_iso, id)`. Default 50, max 200. Envelope `{"items": [...], "next_cursor": null}` per Doc 01 §7.1. Offset pagination is deliberately absent: the board re-sorts on every mutation, so offsets would duplicate or skip rows.

### 3.4 Throttling

| Scope | Rate | Applies to |
| :--- | :--- | :--- |
| `internal` | 120/min per `X-ATLAS-Agent` | claim/heartbeat/progress/submit/propose |
| `upload` | 20/min | `/assets/` |
| `read` | 600/min | `/api/v1` GETs |

`progress` is intentionally high because agents log frequently; it is cheap (one insert + one append).

---

## 4. Serializers (`api/v1/serializers/`)

**Every serializer maps 1:1 to a Doc 01 DTO. No serializer may invent a field.**

| Serializer | DTO | Notes |
| :--- | :--- | :--- |
| `ProjectSerializer` | §7.2 `ProjectDTO` | `counters` computed via `annotate`; `active_agent_id` from the newest `IN_PROGRESS` task; `last_event_at` from `Max(events.created_at)` |
| `TaskSummarySerializer` | §7.3 | `dod_progress_percent`, `is_blocked`, `dependency_weight`, `lease_seconds_remaining`, `is_overdue`, `lease_seconds_overdue` computed |
| `TaskDetailSerializer` | §7.4 | adds DoD, assets, recent events (≤ 50) |
| `ChecklistItemSerializer` | §7.4 `definition_of_done[]` | **`id` = `order_index`** |
| `AssetSerializer` | §7.4 `assets[]` | `absolute_path` + `url` derived, never stored |
| `TaskEventSerializer` | §7.5 | identical to SSE payload |
| `DiscoverySerializer` | §7.6 | `screenshot_absolute_paths` derived from assets |
| `PriorityMatrixSerializer` | §7.7 | values-only query, no model instantiation |
| `TelemetrySummarySerializer` | §7.7 | aggregates |
| `InternalTaskProjectionSerializer` | §9.2 (Doc 01) | the **token-trimmed** projection; Doc 08 forwards this verbatim |

### 4.1 Computed field implementation notes

```python
# TaskSummarySerializer.get_dod_progress_percent — avoid N+1 via annotate in the queryset
def get_dod_progress_percent(self, obj) -> int:
    total = obj.dod_total
    return round(obj.dod_done / total * 100) if total else 0

def get_lease_seconds_remaining(self, obj) -> int:
    if not obj.lease_expires_at:
        return 0
    return max(0, int((obj.lease_expires_at - timezone.now()).total_seconds()))

def get_is_overdue(self, obj) -> bool:
    return obj.lease_overdue_at is not None

def get_lease_seconds_overdue(self, obj) -> int:
    # derived from the clock, not from lease_overdue_at, so the stopwatch keeps
    # counting in the gap between the estimate passing and the 60 s sweeper run
    if not obj.lease_expires_at:
        return 0
    return max(0, int((timezone.now() - obj.lease_expires_at).total_seconds()))

def get_dependency_weight(self, obj) -> float:
    return float(obj.blocked_by_count) + 0.5 * float(obj.open_children_count)
```

`dod_total`, `dod_done`, `blocked_by_count`, `open_children_count` come from queryset annotations (Doc 02 §13), so list endpoints stay within the 6-query budget.

`lease_seconds_remaining` and `lease_seconds_overdue` are **complements**: at most
one of them is non-zero. Neither is an eviction timer — a client that renders
`lease_seconds_remaining == 0` as "task failed" is wrong; it must render
`is_overdue`/`lease_seconds_overdue` as an amber stopwatch and leave the status
alone.

---

## 5. Views

### 5.1 Projects

| Endpoint | Behaviour |
| :--- | :--- |
| `POST /projects/` | Validate slug (`^[a-z][a-z0-9-]{1,31}$`, unique), path absolute string, create row, `scaffold_task`-style project scaffold (`project_meta.json` + `project_audit.log`), audit `PROJECT_CREATED`. |
| `PATCH /projects/{slug}/` | Only `name`, `local_repo_path`, `global_rules_md`, `accent_color`, `claim_limit`. `slug` is `read_only` after creation (Doc 02 D7). |
| `POST /projects/{slug}/archive/` | `{"archived": bool}`, omitted body toggles. Audit `PROJECT_ARCHIVED` / `PROJECT_RESTORED`. |
| `GET /projects/` | `annotate` counters in a single query; `health_percent` from §6.9 of Doc 01. |

`ProjectDTO` carries `claim_limit` (how many tasks an agent may hold `IN_PROGRESS`
at once; `0` = unlimited) and `claim_slots_used` (how many it currently holds).
`PATCH` validates `claim_limit` as an integer `0..50`. Only this route changes the
ceiling — an agent asking for more goes through §5.10.

Archiving a project hides it from `claim_next_task` (Doc 02 `claimable` filters `archived_at__isnull=True`) **and** from `claim_specific_task` (T14) — otherwise `claim-for-agent` would be a hole in the archive. Everything stays readable, and `restore` clears `archived_at`.

### 5.2 Tasks — create & list

```python
class TaskListCreate(APIView):
    def get(self, request, slug):        # filters: status (repeatable), q, min_priority,
        ...                              #   sort=priority|created|updated, order=asc|desc
    def post(self, request, slug):
        ser = TaskCreateSerializer(data=request.data); ser.is_valid(raise_exception=True)
        task = services.tasks.create_task(project_slug=slug, **ser.validated_data)
        return Response(TaskDetailSerializer(task).data, status=201,
                        headers={"Location": f"/api/v1/tasks/{task.id}/"})
```

`TaskCreateSerializer` fields: `title`, `description`, `priority` (0–100, default 50), `definition_of_done` (list[str], ≤ 40), `blocked_by` (list[UUID]), `parent_task_id?`. Validation errors mirror `VALIDATION_ERROR`.

Guards applied on create: `assert_acyclic`, `blocked_by` must exist in the **same project** (`VALIDATION_ERROR` otherwise), DoD list ≤ 40 items (projection ceiling, Doc 01 §9.6).

### 5.3 Priority slider

```python
class TaskPriority(APIView):
    def patch(self, request, task_id):
        new = PrioritySerializer(data=request.data); new.is_valid(raise_exception=True)
        task = services.tasks.set_priority(task_id, new.validated_data["priority"],
                                          actor="human")
        return Response({"id": str(task.id), "priority": task.priority})
```

Idempotent; emits `task.priority_changed`; audit `TASK_PRIORITY`. The UI debounces to 150 ms and sends only the final value (Doc 06).

### 5.4 DoD toggle

`PATCH /tasks/{id}/dod/{item_id}/` body `{"completed": bool}`. `item_id` is the **`order_index`**. Returns `{"item": {...}, "dod_progress_percent": 66}`. Human toggles set `completed_by_agent = null`; agent toggles go through `/internal/v1/dod` and record the agent id.

### 5.4a Operator edits — title, status, assignee, delete

Four routes let a human correct a task without touching storage. All of them
delegate to `core/services/tasks.py`; none of them write a status directly.

| Endpoint | Body | Guard |
| :--- | :--- | :--- |
| `PATCH /tasks/{id}/` | subset of `title`, `description`, `priority`, `blocked_by`, `dod_items` | `status != COMPLETED` (`TASK_IMMUTABLE`) |
| `PATCH /tasks/{id}/status/` | `{"status": "<TASK_STATUS>", "note"?: string}` | target must exist in the §8 guard table |
| `PATCH /tasks/{id}/assignee/` | `{"assigned_agent_id": "<string or null>"}` | `lease_id is null` |
| `DELETE /tasks/{id}/` | — | `PENDING`/`REJECTED`, `attempt_count == 0`, no lease, no submission, **no assets** |

`PATCH` routes `priority` through `set_priority` rather than assigning the column,
so `task.priority_changed` still fires and the HUD's matrix stays in step with the
slider. `dod_items` **replaces** the checklist, preserving `completed` by matching
label — rewriting a typo must not silently un-tick work an agent already did.

`DELETE` is a real delete, not the `archived_at` soft-archive the early draft
implied: an operator who has not even claimed a task expects the row gone. It is
fenced on all five conditions above because deleting a claimed or evidenced task
would orphan an agent's work and its storage. Anything further along returns
`409 TASK_IMMUTABLE` and points at `requeue` / `archive`.

### 5.5 Force release / requeue

| Endpoint | Guard | Effect |
| :--- | :--- | :--- |
| `force-release` | `status == IN_PROGRESS` | `leases.force_release(actor="human")` → `PENDING`; audit `LEASE_RECLAIMED` |
| `requeue` | `status == REJECTED` and every blocker is **satisfied** (100 % DoD) | → `PENDING`, clears `review_notes`, `attempt_count` unchanged. A blocker that is `REJECTED` **and** below 100 % DoD → `409 DEPENDENCY_UNSATISFIABLE` with the blocker in `detail` (a rejected-but-90 %-done blocker is still recoverable, so it does not block) |
| `claim-for-agent` | `status == PENDING`, not blocked, no live lease | Grants a lease to `{agent_identifier}` (T14), audit `LEASE_GRANTED` actor `human`. A live lease → `409 TASK_ALREADY_LEASED` (the **only** emitter of that code) |

Both return the refreshed `TaskDetailDTO`. None is exposed to agents.

**Why `claim-for-agent` exists:** without it, `TASK_ALREADY_LEASED` is unreachable — `claim_next_task` skips leased tasks rather than conflicting, which is correct for a queue but leaves the taxonomy entry dead. T14 gives a human the ability to pin a specific task to a specific agent, which is also the only way to test the conflict path honestly.

### 5.6 Discovery triage

```python
class DiscoveryApprove(APIView):
    def post(self, request, task_id):
        body = ApproveDiscoverySerializer(data=request.data)   # {priority?: 0..100}
        body.is_valid(raise_exception=True)
        task = services.discoveries.approve(task_id, priority=body.validated_data.get("priority"))
        return Response(DiscoverySerializer(task).data)
```

* `approve` → status `PENDING`; `priority = body.priority ?? suggested_priority`; keeps `suggested_priority` for audit (Doc 01 T3).
* `reject` → status `REJECTED`; optional `note` appended to `review_notes`.
* Both are **idempotent-safe**: a second call on an already-transitioned task returns `409 INVALID_TRANSITION` with the current status in `detail` (so the UI can reconcile a stale list).

### 5.7 Review gate

| Endpoint | Body | Guard |
| :--- | :--- | :--- |
| `POST /reviews/{id}/approve/` | `{}` (optional `note`) | `status == IN_REVIEW` |
| `POST /reviews/{id}/reject/` | `{"review_notes": "non-empty"}` | `status == IN_REVIEW`, notes `len >= 3` |

Approve sets `COMPLETED` + `completed_at`; reject returns to `PENDING` with notes (Doc 01 T9) and clears the lease.

**DoD gate on the agent side, advisory on the human side.** `submit_for_review`
(Doc 01 T7) refuses to move a task into `IN_REVIEW` unless the agent has logged
progress **and** every DoD item is ticked — `409 REVIEW_PRECONDITION_FAILED` with
`detail.field` naming which precondition failed. A human approving or rejecting is
not re-gated: the reviewer's job is to judge finished work, and both responses
still include `dod_progress_percent` so the UI can warn in amber.

### 5.8 Assets

```python
class AssetUpload(APIView):
    parser_classes = [MultiPartParser]
    throttle_scope = "upload"

    def post(self, request):
        ser = AssetUploadSerializer(data=request.data)   # task_id, kind, source?, file
        ser.is_valid(raise_exception=True)
        asset = services.assets.ingest(**ser.validated_data)   # Doc 02 §10 pipeline
        return Response(AssetSerializer(asset).data, status=201)
```

`GET /assets/{id}/content` streams the file in 64 kB chunks with `Content-Type` from the row, `ETag: sha256`, `Cache-Control: private, max-age=31536000, immutable` (content-addressed, so immutable is correct). `download` adds `Content-Disposition: attachment; filename="…"`.

**Screenshot markup.** `POST /assets/{id}/annotation/` takes a multipart body of
`image` (the flattened PNG), `document` (the stroke JSON), and `replace_source`
(`1`/`0`). It always appends a **new** `ANNOTATED_CANVAS` row — evidence is
append-only — and writes the stroke document as `<stem>.canvas.json` beside the
flattened image, so the markup stays re-editable. When `replace_source=1` the
source asset's bytes are rewritten in place and its `sha256` recomputed, which
keeps every existing link and every `content` URL valid; the previous revision
survives as the `ANNOTATED_CANVAS` row. `GET` returns the side-car or `null`.

`GET /projects/{slug}/assets/` returns `[{task_id, images[], total}]` with at most
`PREVIEWS_PER_TASK = 3` images per task and the **true** total alongside, so the
board can render a "+2" badge without a second query. `?task_id=<uuid>` widens the
cap to every image on that task (the editor's list, and uploads are uncapped).
This exists as its own route because `TaskSummaryDTO` is frozen at its projection
budget (Doc 01 §7.3) and must not grow an `assets` array.

**Thumbnails.** Every image asset gets a downscaled sibling at ingest
(`core/services/thumbnails.py`, longest edge 400 px, PNG when it has alpha and
otherwise JPEG q82) recorded in `Asset.thumbnail_relative_path`. `AssetDTO` exposes
`thumbnail_url` → `GET /assets/{id}/thumbnail`, which falls back to the original
bytes when no thumbnail exists (non-images, undecodable uploads, rows written
before the feature). Small surfaces — board tiles, list rows, the editor's preview
grid — use the thumbnail; full-size viewers (markup, canvas, the review pane) keep
`/content`. Deleting an asset removes both files, and burn-in regenerates the
thumbnail so the board never shows pre-markup pixels. Run
`scripts/backfill_thumbnails.py` once after upgrading an existing install.

### 5.10 Claim-limit requests

| Endpoint | Body | Behaviour |
| :--- | :--- | :--- |
| `GET /claim-limit-requests/` | `?project_slug=` | Pending requests, newest first |
| `POST /claim-limit-requests/{id}/resolve/` | `{"approve": bool, "note"?, "granted_limit"?}` | Approve applies the ceiling; dismiss leaves it untouched |

These are the **operator** half of the concurrent-claim ceiling. The agent half is
`POST /internal/v1/claim-limit` (§6), which only ever creates a `PENDING` row: an
agent must not be able to raise its own limit, and keeping creation and resolution
on different surfaces is what makes that structural rather than a convention.
Approving applies `granted_limit` (defaulting to the requested value) to
`Project.claim_limit`; `granted_limit = 0` ("unlimited") is rejected here because
unlimited is an operator-only decision made in project settings.

### 5.11 Telemetry & matrix

| Endpoint | Query | Response |
| :--- | :--- | :--- |
| `GET /telemetry/summary` | optionally `?project_slug=` | §7.7 `TelemetrySummaryDTO` |
| `GET /priority-matrix` | `?x=age_hours\|dependency_weight`, `?project_slug=` | §7.7 matrix, ≤ 500 points |

Matrix uses `.values(...)` only (no model instances) and caps at 500 points ordered by priority desc — beyond that the HUD switches to a density view (Doc 06 §11).

---

## 6. Internal Agent RPC

### 6.1 Shared behaviour

```python
class InternalBase(APIView):
    authentication_classes = [BearerTokenAuthentication]
    permission_classes = [IsAuthenticated]
    renderer_classes = [JSONRenderer]
    throttle_scope = "internal"

    def initial(self, request, *a, **kw):
        super().initial(request, *a, **kw)
        if not request.headers.get("X-ATLAS-Agent"):
            raise ValidationError(code="VALIDATION_ERROR",
                                  detail={"X-ATLAS-Agent": ["required"]})
```

`X-ATLAS-Agent` is mandatory on every internal call: it feeds rate limiting, audit `actor`, and `assigned_agent_id` fallback. Omitting it is a client bug that should fail fast rather than silently attributing work to "unknown".

### 6.2 Route contracts

| Route | Request | Response | Errors |
| :--- | :--- | :--- | :--- |
| `/claim` | `{project_slug, agent_identifier, min_priority?}` | §9.2 projection or `{task_id:null, reason:"NO_ELIGIBLE_TASK"}` | 404 `PROJECT_NOT_FOUND`, 502 `BACKEND_UNAVAILABLE` |
| `/heartbeat` | `{task_id, lease_id}` | `{ok:true, lease_expires_at, is_overdue:false, lease_seconds_overdue:0}` | 409 `STALE_LEASE` — **only** for a `lease_id` mismatch; a blown estimate still returns `200` |
| `/progress` | `{task_id, message, level?}` | `{ok:true}` (exactly) | 404 `TASK_NOT_FOUND` |
| `/dod` | `{task_id, item_id, completed}` | `{ok:true, dod_progress_percent}` | 404, 409 `INVALID_TRANSITION` |
| `/submit` | `{task_id, summary_of_work, git_patch, verification_log?}` | `{ok:true, status:"IN_REVIEW", dod_progress_percent}` | 409 `STALE_LEASE`, 409 `INVALID_TRANSITION`, 413, 507 |
| `/propose` | `{project_slug, title, description, suggested_priority, discovered_during_task_id, screenshot_paths?}` | `{ok:true, task_id, status:"PENDING_APPROVAL"}` | 400 `PATH_OUT_OF_SCOPE`, 404 |
| `/subtask` | `{parent_task_id, title, description, priority}` | `{ok:true, task_id}` | 404, 400 |
| `/task` | `{task_id}` | §9.2 projection | 404 |

### 6.3 Idempotency (Doc 01 §10)

```python
def submit_idempotent(task_id, git_patch, **kwargs):
    digest = hashlib.sha256(git_patch.encode()).hexdigest()
    cache_key = f"submit:{task_id}:{digest}"
    if cached := cache.get(cache_key):            # Django LocMemCache, 10 min TTL
        return cached
    result = services.reviews.submit(task_id, git_patch=git_patch, **kwargs)
    cache.set(cache_key, result, 600)
    return result
```

`propose` dedupes on `(project_slug, lower(title), discovered_during_task_id)` within 10 minutes and returns the existing `task_id` — preventing an agent loop from flooding the inbox.

### 6.4 Projection contract

`/claim` and `/task` return the **trimmed** projection (§9.2), not `TaskDetailDTO`. Truncation happens in the serializer (`InternalTaskProjectionSerializer`) so the token ceiling holds even for a hand-crafted curl call — Doc 08 must not be the only guard.

Projection limits: `description` ≤ 8 000 chars, `project_rules` ≤ 1 200, `attached_images` ≤ 10 (most recent), `definition_of_done` ≤ 40. Total payload asserted ≤ 16 kB in tests.

---

## 7. Multipart & Upload Path Policy

1. Stream the incoming file to `storage/.uploads/{uuid}.part` (never fully in memory).
2. Enforce `ATLAS_MAX_UPLOAD_MB` while streaming (`413` on breach, abort + unlink).
3. Sniff MIME from the first 512 bytes (magic numbers) and compare with the declared type and the allow-list (`415`).
4. Compute `sha256` during streaming.
5. Hand the part file to `StorageRouter.write_bytes`-equivalent promotion (atomic `os.replace` into the task folder).
6. Insert the `Asset` row in the request transaction.

`storage/.uploads/` is swept on boot (files older than 6 h). The `.part` extension means a crashed upload can never be mistaken for a real asset.

---

## 8. CORS, Security Headers & Middleware

```python
MIDDLEWARE = [
    "api.common.middleware.RequestIdMiddleware",      # req_<ULID>, X-Request-ID
    "api.common.middleware.LoopbackGuardMiddleware",  # dev only
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "api.common.middleware.SecurityHeadersMiddleware",# CSP, nosniff, frame-deny
    ...
]
CORS_ALLOWED_ORIGINS = [env("ATLAS_WEB_ORIGIN", default="http://localhost:3471")]
CORS_ALLOW_CREDENTIALS = False                        # bearer only, no cookies
```

Headers on every response: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Cross-Origin-Resource-Policy: same-site`. CSP applies to the Django admin only (the app UI is served by Next.js with its own CSP).

**SSE exception:** `/api/v1/stream/*` must bypass compression and the CORS preflight cache; Doc 09 sets `X-Accel-Buffering: no` and no `Content-Length`.

---

## 9. Query Budgets & Performance

| Endpoint | Max queries | P95 target |
| :--- | :--- | :--- |
| `GET /projects/` | 2 | < 25 ms |
| `GET /projects/{slug}/tasks/` (50 rows) | 6 | < 40 ms |
| `GET /tasks/{id}/` | 10 | < 45 ms |
| `PATCH /priority/` | 4 | < 15 ms |
| `POST /internal/v1/claim` | 6 | < 20 ms (p95 under contention) |
| `GET /priority-matrix` (500 pts) | 1 | < 30 ms |
| `POST /assets/` (5 MB) | 3 | < 250 ms |

Enforced by `django_assert_num_queries` in the API test suite (Doc 10). Regressions fail CI.

---

## 10. Test Matrix (Doc 04 scope)

| Area | Cases |
| :--- | :--- |
| Auth | missing token 401, bad token 401, valid token 200, internal missing `X-ATLAS-Agent` 400 |
| Projects | create/duplicate-slug 400, slug immutable on PATCH, archive hides from claim, archive hides from `claim-for-agent`, restore re-enables both |
| Tasks | create with DoD, 41 DoD items 400, blocked_by cross-project 400, cycle 409 |
| Operator edits | PATCH each whitelisted field, PATCH on COMPLETED 409, `dod_items` replace keeps completed by label, status override per guard table, status override to a forbidden target 409, assignee change while leased 409, DELETE on a claimed task 409, DELETE with assets 409 |
| Priority | 0 and 100 accepted, -1 and 101 rejected, idempotent repeat, PATCH emits `task.priority_changed` |
| DoD | toggle on/off, item_id mismatch 404, progress percent correct |
| Discovery | approve sets priority, approve twice 409, reject then requeue |
| Review | approve without 100 % DoD succeeds, reject without notes 400, reject clears lease |
| Claim | no tasks → 2-field response, lowest eligibility respected, `min_priority` filter |
| Submit | oversized patch 413, stale lease 409, rollback leaves no Asset row |
| Assets | oversize 413, wrong MIME 415, dedupe by sha256, content ETag, annotation appends a new row, `replace_source` rewrites the source bytes, annotation side-car round-trips, previews cap at 3 with a true total |
| Matrix | both x modes, cap at 500, blocked flag correct |
| Errors | every §15 code has an assertion for shape + status + `request_id` |
| Budgets | query counts per §9 |

---

## 11. Definition of Done — Doc 04

- [ ] Every route in §2 exists, is authenticated (except `/healthz`), and returns a Doc 01 DTO.
- [ ] All 10 error codes in §3.2 are produced by at least one test.
- [ ] `/internal/v1/claim` and `/task` enforce the projection ceiling server-side.
- [ ] `submit` is idempotent per `(task_id, sha256(patch))`; `propose` dedupes within 10 min.
- [ ] Uploads stream, sniff MIME, dedupe by sha256, and never buffer > 1 MB in memory.
- [ ] Query budgets from §9 hold under test.
- [ ] No view contains business rules; all transitions go through `core/services`.
- [ ] Operator mutations (`PATCH`, `DELETE`, `status`, `assignee`, `archive`) reuse the same service functions the MCP path uses, so a transition cannot be reachable from REST but forbidden from MCP (or vice versa).
- [ ] `GET /healthz` exposes the Doc 03 `StartupReport` and requires no auth.

---

## 12. Cross-Document Contracts

| Direction | Item |
| :--- | :--- |
| **Consumes Doc 01** | §7 DTOs, §8 transition table, §10 internal RPC, §12 routes, §15 errors |
| **Consumes Doc 02** | models, `StorageRouter`, `ensure_within_root`, `services.tasks` |
| **Consumes Doc 03** | `leases.claim_next_task/heartbeat/force_release`, `StartupReport` |
| **Publishes → Doc 06** | REST schemas (mirrored in `frontend/lib/types`) |
| **Publishes → Doc 08** | `/internal/v1` request/response shapes + idempotency keys |
| **Publishes → Doc 09** | Route mount points for `stream/*`; `TaskEvent` creation on every mutation |
| **Publishes → Doc 10** | Endpoint list for the E2E harness |

---

## 13. Implementation Checklist for Subagent 4

1. `api/common/` — `auth.py`, `errors.py`, `pagination.py`, `middleware.py`, `renderers.py`.
2. `atlas/urls.py` + `api/v1/urls.py` + `api/internal/urls.py` skeleton (404-complete before behaviour).
3. Project serializers/views → tests.
4. Task serializers (`summary`, `detail`, `create`) → views → tests, including query budgets.
5. Priority + DoD endpoints → tests.
6. Discovery + review endpoints → tests (transition guards).
7. Asset upload pipeline → tests (streaming, MIME, dedupe).
8. Telemetry + matrix (values-only) → tests.
9. Internal RPC (8 routes) → idempotency + projection ceiling tests.
10. Error-taxonomy sweep: one test per §15 code.
11. Wire `sse` routes to Doc 09's generators (import only).
