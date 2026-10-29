# ATLAS-MCP — Plan Series Index

> **Status:** Series v1.0.0 · authored 2026-10-27
> **Parent specification:** [`master_implementation_plan.md`](./master_implementation_plan.md)
> **Contract authority:** [`01_system_architecture.md`](./01_system_architecture.md) — when any document disagrees with it, **Doc 01 wins** and the other document is defective.

---

## 1. What this series is

The master plan describes *what* ATLAS-MCP is and *why* it exists. This series turns that into **ten independently executable implementation specifications** so that ten subagents can build in parallel without merge conflicts, interface drift, or duplicated decisions.

Each document is:

* **Self-contained** — an implementer needs only their own doc plus Doc 01.
* **Boundary-enforcing** — an explicit owned-path list, so file ownership is never ambiguous.
* **Contract-first** — every cross-boundary call is a frozen schema, not a conversation.
* **Testable** — a Definition of Done that a reviewer can verify by inspection or by running one command.

---

## 2. Document map

| # | Document | Owner | Owned paths | Consumes | Publishes to |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **01** | [System Architecture & Data Contracts](./01_system_architecture.md) | Lead Architect | `plan-series/`, contracts | master plan | everyone |
| **02** | [Database Models & Storage File Router](./02_database_storage_engine.md) | Backend Engine | `backend/core/models/`, `core/storage.py`, `core/audit.py`, `core/paths.py` | 01 | 03, 04, 08, 10 |
| **03** | [Fault Tolerance, Leases & Crash Recovery](./03_fault_tolerance_recovery.md) | Reliability Specialist | `backend/core/leases.py`, `core/recovery.py`, `core/apps.py`, `core/maintenance.py` | 01, 02 | 04, 08, 09, 10 |
| **04** | [Django Core REST & Triage API](./04_django_rest_api.md) | API Developer | `backend/api/**` (excl. `sse.py`), `atlas/urls.py` | 01, 02, 03 | 06, 08, 09, 10 |
| **05** | [Tactical Cyber-HUD Design System](./05_hud_design_system.md) | Design Engineer | `frontend/styles/`, `tailwind.config.ts`, `components/ui/`, `components/hud/` | 01 | 06, 07, 09 |
| **06** | [Next.js Dual Split-Board Command Dashboard](./06_nextjs_dashboard.md) | Frontend Core | `frontend/app/`, `components/{board,matrix,tasks,discoveries}/`, `hooks/`, `lib/{api,types,format}/` | 01, 05, 07, 09 | 10 |
| **07** | [In-App Canvas Annotation Engine](./07_canvas_annotation_engine.md) | Canvas Specialist | `frontend/components/canvas/`, `frontend/lib/canvas/` | 01, 05 | 06 |
| **08** | [FastMCP Protocol Server & Tool Contracts](./08_mcp_server_protocol.md) | MCP Protocol Lead | `mcp_server/` | 01, 02, 03 | 10 |
| **09** | [Real-Time SSE Event & Terminal Stream](./09_realtime_terminal_sse.md) | Streaming Specialist | `backend/api/sse.py`, `backend/core/events.py`, `frontend/components/terminal/`, `frontend/lib/sse/` | 01, 02, 04 | 06 |
| **10** | [End-to-End Verification & Acceptance Harness](./10_e2e_verification_harness.md) | QA & Validation | `tests/**`, `scripts/**`, `frontend/e2e/` | 01–04 | series gate |

---

## 3. Dependency graph

```
                        ┌──────────────────────────────┐
                        │  MASTER IMPLEMENTATION PLAN  │
                        └──────────────┬───────────────┘
                                       ▼
                        ┌──────────────────────────────┐
                        │  01  ARCHITECTURE & CONTRACTS│  ← frozen source of truth
                        └───┬──────────┬───────────┬───┘
             ┌──────────────┘          │           └──────────────┐
             ▼                         ▼                          ▼
   ┌──────────────────┐      ┌──────────────────┐       ┌──────────────────┐
   │ 02 DATABASE &    │      │ 05 HUD DESIGN    │       │ 08 MCP SERVER    │
   │    STORAGE       │      │    SYSTEM        │       │  (needs 02, 03)  │
   └────┬─────────┬───┘      └────┬────────┬────┘       └──────────────────┘
        │         │               │        │
        ▼         ▼               ▼        ▼
   ┌─────────┐ ┌────────────┐ ┌──────────┐ ┌──────────────┐
   │ 03 FAULT│ │ 04 DJANGO  │ │ 06 NEXT  │ │ 07 CANVAS    │
   │TOLERANCE│ │ REST API   │ │DASHBOARD │ │ ANNOTATION   │
   └────┬────┘ └─────┬──────┘ └────┬─────┘ └──────┬───────┘
        │            │             │              │
        │            ▼             ▼              │
        │      ┌──────────┐  ┌──────────┐         │
        └─────▶│ 09 SSE   │  │ (imports)│◀────────┘
               │ TERMINAL │  │ 05,07,09 │
               └────┬─────┘  └────┬─────┘
                    └────────┬────┘
                             ▼
                  ┌──────────────────────┐
                  │ 10 E2E VERIFICATION  │  ← series acceptance gate
                  └──────────────────────┘
```

### 3.1 Build waves (parallel-safe order)

| Wave | Docs in flight | Rationale |
| :--- | :--- | :--- |
| **0** | 01 | Contracts must exist before anything else moves. |
| **1** | 02, 05 | Data layer and design tokens have no dependency on each other. |
| **2** | 03, 04, 06, 07 | 03 needs 02; 04 needs 02+03; 06 needs 05; 07 needs 05. Frontend mocks (§16 of Doc 01) unblock 06/07 before the backend is live. |
| **3** | 08, 09 | 08 needs 02+03+04; 09 needs 04+02. |
| **4** | 10 | Full stack must be reachable. |

---

## 4. Reading paths

### 4.1 "I am implementing my assigned document"

1. Read **Doc 01 completely** (it is the contract).
2. Read your own document completely.
3. Read only the **"Cross-Document Contracts"** section of your upstream docs — not the whole doc.
4. Skim the **Definition of Done** of your downstream docs so you do not break them.
5. Start with your **Implementation Checklist** (the last section of your doc); it is ordered by dependency.

### 4.2 "I am reviewing the series"

1. Doc 01 §17 (capability traceability) — every master capability must have an owner and a verification point.
2. Each doc's **Definition of Done** — is each item falsifiable?
3. Doc 10 §6 (acceptance matrix) — is every capability actually tested?
4. Drift hunt: does any doc restate a contract differently from Doc 01?

### 4.3 "I am onboarding to the codebase later"

`01 → 02 → 03 → 04 → 08 → 09 → 05 → 06 → 07 → 10`. That order follows the data: a task is created, persisted, leased, exposed, consumed by an agent, streamed, styled, displayed, annotated, and verified.

---

## 5. Frozen contracts (summary of what cannot change)

| Contract | Value | Defined in |
| :--- | :--- | :--- |
| Contract version | `1.0.0` | 01 §1.2 |
| Ports | Next `3471`, Django `8471` | 01 §2.2 |
| Task statuses | `PENDING_APPROVAL`, `PENDING`, `IN_PROGRESS`, `IN_REVIEW`, `COMPLETED`, `REJECTED` | 01 §6.2 |
| Log levels | `DEBUG`, `INFO`, `WARN`, `ERROR` | 01 §6.2 |
| Event types | 18 values, `noun.verb` form | 01 §6.2 |
| Lease TTL / heartbeat / grace | `900 s` / `120 s` / `60 s` | 01 §11.2 |
| Token projection ceiling | `16 kB`, description `8 000` chars, rules `1 200` chars, 10 images, 40 DoD items | 01 §9.6 |
| Designed log confirmation | `{"ok": true}` — exactly two fields | 01 §9.5 |
| Storage root env | `ATLAS_STORAGE_ROOT` | 01 §13 |
| JSON casing | `snake_case` everywhere | 01 §5 |
| Timestamps on the wire | ISO-8601 UTC `Z`, ms precision | 01 §5 |
| Asset paths | DB stores POSIX-relative; responses derive absolute | 01 §5 |
| Base64 in any payload | **forbidden** | 01 §9.6 |

Any change requires: a `CONTRACT-CHANGE` note in Doc 01 §20, a version bump, and same-PR updates to every consumer.

---

## 6. Invariants the whole system must preserve

| ID | Invariant | Falsified by |
| :--- | :--- | :--- |
| I1 | Claims equal distinct leases issued | `test_claim_lease_bijection` (Doc 10) |
| I2 | No double-claim under concurrency | `test_parallel_claims` — 20 threads, 10 tasks |
| I3 | `IN_PROGRESS` ⇒ exactly one live lease | `ck_task_lease_invariant` + test |
| I4 | Stale heartbeat mutates nothing | `test_stale_heartbeat_noop` |
| I5 | A missed estimate never evicts an agent | `test_i5_boot_recovery_flags_overdue_leases_without_reclaiming` |
| I6 | No partial files after a crash | `scripts/simulate_power_cut.py` |
| I7 | A committed row always has its file | write-before-commit (Doc 03 §7.1) |
| I8 | `seq` is gap-free per project | unique `(project, seq)` + replay test |
| I9 | Agent payloads never exceed 16 kB and never contain base64 | MCP conformance suite |
| I10 | Every state change is reachable only through a guarded transition | §8 table in Doc 01 |

---

## 7. Capability ownership (master §6 → document)

| # | Capability | Owner | Verified in |
| :--- | :--- | :--- | :--- |
| 1 | Atomic claim protocol | 03 / 04 / 08 | 10 §5, §6 |
| 2 | DoD checklists | 02 / 04 / 08 | 10 §6 |
| 3 | Verification gates | 04 / 06 / 08 | 10 §6 |
| 4 | Subtask spawning | 04 / 08 | 10 §6 |
| 5 | Dependency blocking (DAG) | 02 / 04 | 10 §6 |
| 6 | In-app canvas annotation | 07 | 10 §11 |
| 7 | Cyber HUD theme | 05 | 05 §13, 10 §11 |
| 8 | Split multi-agent dashboard | 06 | 10 §11 |
| 9 | Live SSE terminal stream | 09 | 10 §12 |
| 10 | Keyboard-first navigation | 06 | 10 §11 |
| 11 | Visual priority matrix | 06 | 10 §11 |
| 12 | Project root detection | 02 / 08 | 10 §6 |
| — | Leases & crash recovery | 03 | 10 §7 |
| — | Token conservation | 08 | 10 §9 |
| — | Discovery pipeline | 04 / 08 | 10 §6 |

---

## 8. Working agreement for the ten subagents

1. **Own your paths.** Never edit a file outside your owned prefixes. If you need a change elsewhere, file it as a defect in the owning doc's language.
2. **Never restate a contract from memory.** Copy from Doc 01 verbatim.
3. **Build against mocks first.** Frontend docs use the fixture pack in Doc 01 §16 so backend work never blocks UI work.
4. **Short code, high specificity.** Specs contain sketches (≤ 45 lines), not full implementations; real code lives in the repo.
5. **Every decision is labelled.** If the master plan is silent, write `**Decision:**` with a one-line rationale so reviewers can challenge it directly.
6. **Definition of Done is binary.** An item is either verifiable by a command/inspection or it does not belong on the list.
7. **No silent scope growth.** Additions must be additive contract surfaces (like the four supporting MCP tools), never mutations of a frozen core.

---

## 9. Glossary (shared vocabulary)

| Term | Meaning |
| :--- | :--- |
| **Task** | The unit of agent work; carries a DoD checklist and a lease. |
| **Lease** | A time-boxed claim (`900 s`) that makes a task exclusively owned; renewed by heartbeat. |
| **DoD** | Definition of Done — an ordered checklist the agent ticks off. |
| **Discovery** | An out-of-scope anomaly an agent proposes via `propose_task`; lands in `PENDING_APPROVAL`. |
| **Triage inbox** | The HUD queue of `PENDING_APPROVAL` discoveries awaiting human approve/reject. |
| **Review gate** | The `IN_REVIEW` state requiring human sign-off before `COMPLETED`. |
| **Janitor** | Boot-time routine that flags leases whose estimate passed as OVERDUE and repairs folders. It never returns a task to `PENDING`. |
| **Sweeper** | Runtime thread that flags overdue leases every 60 s. Advisory only — a human takes work back (`T11`). |
| **Projection** | The token-trimmed view of a task that is safe to send to an agent. |
| **Containment** | The path check that forces every agent-supplied path inside `ATLAS_STORAGE_ROOT`. |
| **Pane** | One of the 1–4 split workspaces in the HUD workbench. |
| **Wave** | A parallel-safe group of documents that can be implemented simultaneously. |

---

## 10. Series acceptance gate

The series is complete when all of the following hold:

- [ ] All ten documents exist, each with a Definition of Done.
- [ ] Every capability in master §6 has exactly one owning document and one verification point (Doc 10 §6).
- [ ] Every invariant I1–I10 has a falsifying test.
- [ ] No document contradicts Doc 01 (drift audit in `scripts/verify_series.py`).
- [ ] Every cross-boundary call appears as a schema in both producer and consumer docs.
- [ ] Doc 10's CI pipeline is green from a clean clone with no skipped tests.
