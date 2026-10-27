# ATLAS-MCP

Multi-Agent Task & Logging Archive System — a local, single-operator control plane
for orchestrating several coding agents against several repositories.

Agents claim work through MCP tools; a Cyber-HUD dashboard shows the live board,
priority matrix, annotation canvas and streamed agent logs. Everything runs on
loopback; SQLite is the only datastore.

---

## Quick start

```powershell
# 1. Backend dependencies (Python 3.11+)
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt

# 2. Frontend dependencies (Node 20+)
npm --prefix frontend install

# 3. Generate .env files, migrate, and print the MCP client snippet
.\.venv\Scripts\python.exe scripts\bootstrap_dev.py

# 4. Optional: realistic demo data (2 projects, 13 tasks, discoveries, review)
.\.venv\Scripts\python.exe scripts\seed_demo.py

# 5. Run both servers
.\.venv\Scripts\python.exe backend\manage.py runserver 127.0.0.1:8471
npm --prefix frontend run dev          # http://localhost:3471
```

Ports are deliberately uncommon (`8471`/`3471`) so they do not collide with other
local projects. Change them in `.env`, `frontend/.env.local`, and
`frontend/package.json`.

---

## Layout

```
ATLAS-MCP/
├── plan-series/        10 implementation specs + README (the design authority)
├── backend/            Django 5.2 + DRF: domain core, REST API, SSE
│   ├── atlas/          settings, URLs, ASGI/WSGI
│   ├── core/           models, storage router, leases, recovery, services
│   ├── api/            /api/v1, /internal/v1, sse.py
│   └── data/           SQLite (gitignored)
├── frontend/           Next.js 15 + React 19 + Tailwind v4
│   ├── app/            routes + the /api/v1 proxy route handler
│   ├── components/     ui, hud, board, matrix, tasks, discoveries, canvas, terminal
│   ├── lib/            api client, types, sse client, canvas engine, format helpers
│   ├── hooks/          keyboard, hotkeys, toast, clock
│   └── styles/         frozen design tokens
├── mcp_server/         FastMCP stdio server exposing 8 tools
├── storage/            runtime artifacts (gitignored)
├── scripts/            bootstrap, seed, mocks, verification gates
└── tests/              unit, integration (DB), e2e
```

---

## The contract

`plan-series/01_system_architecture.md` is the frozen authority. Every other doc
and every line of code defers to it. The pieces most worth knowing:

| Concept | Value |
| :--- | :--- |
| Contract version | `1.0.0` |
| Task statuses | `PENDING_APPROVAL`, `PENDING`, `IN_PROGRESS`, `IN_REVIEW`, `COMPLETED`, `REJECTED` |
| Lease TTL / heartbeat / grace | 900 s / 120 s / 60 s |
| MCP token ceiling | 16 384 bytes per tool response |
| Max patch | 5 MB |
| Ports | backend 8471, frontend 3471, loopback only |

**Why the claim is a single `UPDATE`:** SQLite has no `SELECT … FOR UPDATE`, and
Django silently ignores `select_for_update()` on it. The claim is therefore a
conditional single-statement `UPDATE … WHERE status='PENDING'` inside an
`IMMEDIATE` transaction; the affected-row count is the linearisation point.
See `backend/core/leases.py` and Doc 01 §11.

---

## MCP tools

| Tool | Kind | Purpose |
| :--- | :--- | :--- |
| `claim_next_task` | core | Lease the highest-priority eligible task |
| `propose_task` | core | Record an agent-discovered task for triage |
| `submit_for_review` | core | Attach a patch + log and move to `IN_REVIEW` |
| `log_task_progress` | core | Append one sanitised line; returns `{"ok": true}` |
| `task_heartbeat` | supporting | Renew a lease |
| `update_dod_item` | supporting | Tick a definition-of-done item |
| `spawn_subtask` | supporting | Create a child task |
| `get_task_details` | supporting | Re-read a projected task |

`python scripts/bootstrap_dev.py` prints a ready-to-paste
`.vscode/mcp.json` / `claude_desktop_config.json` block.

---

## Verification

```powershell
# Backend: 33 integration tests (incl. the 20-thread claim race, I1–I6)
.\.venv\Scripts\python.exe -m pytest -q

# Frontend: 41 unit tests (SSE parser, ring buffer, formatters, API client)
npm --prefix frontend test

# End-to-end: 9 Playwright specs against the real backend
npm --prefix frontend run test:e2e

# Cross-document drift gates (tokens, error codes, constants, migrations,
# routes, encoding, doc structure) — 7 gates
.\.venv\Scripts\python.exe scripts\verify_series.py

# Production build (bundle budget check)
npm --prefix frontend run build
```

`verify_series.py` is the drift gate: it fails the build if a design token,
error code, frozen constant, route, or documented structure diverges from the
specs. Run it before every commit that touches both docs and code.

---

## Design decisions worth knowing

- **One writer, WAL, `IMMEDIATE` transactions.** Readers never block; the write
  lock is taken at `BEGIN` so two claims cannot interleave.
- **Files before rows.** A file is written and `fsync`ed before the row that
  references it, so a row with a path always points at real bytes. Writes go to
  a temp file in the same directory, then `os.replace` (atomic on one volume).
- **Dual-path rule.** The DB stores POSIX-relative asset paths; absolute native
  paths are derived at response time. Moving the repo does not invalidate rows.
- **SSE, not WebSockets.** Unidirectional, `EventSource` reconnects for free, and
  a Next.js rewrite cannot proxy WS upgrades. Two routes: one per project, one
  per task.
- **The browser never holds the token.** `/api/v1/*` is proxied by a Next.js
  route handler that injects `Authorization` server-side.
- **Agents are token-constrained.** The claim projection carries no timestamps,
  no event history, no base64 — and is hard-capped at 16 384 bytes.

---

## Open items

- `submit` idempotency uses a per-process cache. A multi-worker deployment would
  need a shared store (tracked as `DEF-08-02` in Doc 10).
- `stream.reset` is a transport-only pseudo-type, intentionally absent from the
  `EventType` enum.

---

## Licence

Private / unlicensed. Not for redistribution.
