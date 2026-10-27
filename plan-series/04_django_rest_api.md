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
| PATCH | `/tasks/{task_id}/` | `TaskDetail` | Title / description / DoD append |
| PATCH | `/tasks/{task_id}/priority/` | `TaskPriority` | Priority slider (0–100) |
| DELETE | `/tasks/{task_id}/` | `TaskDetail` | Archive (soft) → `REJECTED` |
| PATCH | `/tasks/{task_id}/dod/{item_id}/` | `TaskDodItem` | Toggle a checklist item |
| POST | `/tasks/{task_id}/force-release/` | `TaskForceRelease` | Reclaim from a wedged agent (T11) |
| POST | `/tasks/{task_id}/requeue/` | `TaskRequeue` | `REJECTED` → `PENDING` |
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
| `TaskSummarySerializer` | §7.3 | `dod_progress_percent`, `is_blocked`, `dependency_weight`, `lease_seconds_remaining` computed |
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

def get_dependency_weight(self, obj) -> float:
    return float(obj.blocked_by_count) + 0.5 * float(obj.open_children_count)
```

`dod_total`, `dod_done`, `blocked_by_count`, `open_children_count` come from queryset annotations (Doc 02 §13), so list endpoints stay within the 6-query budget.

---

## 5. Views

### 5.1 Projects

| Endpoint | Behaviour |
| :--- | :--- |
| `POST /projects/` | Validate slug (`^[a-z][a-z0-9-]{1,31}$`, unique), path absolute string, create row, `scaffold_task`-style project scaffold (`project_meta.json` + `project_audit.log`), audit `PROJECT_CREATED`. |
| `PATCH /projects/{slug}/` | Only `name`, `global_rules_md`, `accent_color`, `archived_at`. `slug` and `local_repo_path` are `read_only` after creation (Doc 02 D7). |
| `GET /projects/` | `annotate` counters in a single query; `health_percent` from §6.9 of Doc 01. |

Archiving a project hides it from `claim_next_task` (Doc 02 `eligible_for_claim` filters `archived_at__isnull=True`) but keeps everything readable.

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

### 5.5 Force release / requeue

| Endpoint | Guard | Effect |
| :--- | :--- | :--- |
| `force-release` | `status == IN_PROGRESS` | `leases.force_release(actor="human")` → `PENDING`; audit `LEASE_RECLAIMED` |
| `requeue` | `status == REJECTED` | → `PENDING`, clears `review_notes`, `attempt_count` unchanged |

Both return the refreshed `TaskDetailDTO`. Neither is exposed to agents.

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

**DoD advisory, not a gate:** both responses include `dod_progress_percent`; the UI warns in amber when < 100 but does not block (Doc 01 §8).

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

### 5.9 Telemetry & matrix

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
| `/heartbeat` | `{task_id, lease_id}` | `{ok:true, lease_expires_at}` | 409 `STALE_LEASE` |
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
CORS_ALLOWED_ORIGINS = [env("ATLAS_WEB_ORIGIN", default="http://localhost:3000")]
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
| Projects | create/duplicate-slug 400, slug immutable on PATCH, archive hides from claim |
| Tasks | create with DoD, 41 DoD items 400, blocked_by cross-project 400, cycle 409 |
| Priority | 0 and 100 accepted, -1 and 101 rejected, idempotent repeat |
| DoD | toggle on/off, item_id mismatch 404, progress percent correct |
| Discovery | approve sets priority, approve twice 409, reject then requeue |
| Review | approve without 100 % DoD succeeds, reject without notes 400, reject clears lease |
| Claim | no tasks → 2-field response, lowest eligibility respected, `min_priority` filter |
| Submit | oversized patch 413, stale lease 409, rollback leaves no Asset row |
| Assets | oversize 413, wrong MIME 415, dedupe by sha256, content ETag |
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
