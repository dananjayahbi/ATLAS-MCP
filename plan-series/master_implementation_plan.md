# ATLAS-MCP: Autonomous Agentic Orchestrator & Command Center
## Master Architectural Blueprint & Implementation Specification

---

## 1. Executive Summary & Core System Philosophy

ATLAS-MCP is an asynchronous, multi-agent engineering orchestration platform designed to eliminate the human-in-the-loop waiting bottleneck during AI software development. The system decouples task authoring, visual bug reporting, and architectural decision-making from synchronous agent execution. 

A single human software architect can direct multiple distinct agentic CLI instances (e.g., Claude Code, GitHub Copilot autopilot) running across isolated projects concurrently from a centralized, cybernetic command dashboard.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        HUMAN ARCHITECT / PM                            │
│  - Authors Tasks & Checklist DoD       - Inspects Visual Patches       │
│  - Prioritizes via Percentage Sliders  - Triages Agent Discoveries     │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                         HTTPS / SSE│(Port 3000 <-> 8000)
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                 ATLAS WEB COMMAND HUD (Next.js 15)                     │
│  - Dual/Quad Project Split View        - In-App Screenshot Canvas      │
│  - 2D Visual Priority Matrix           - Live Agent Terminal Stream    │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                 IPC│/ Local Network
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│               ORCHESTRATION ENGINE (Django 5 + SQLite WAL)             │
│  - Atomic Task Lease Manager           - Fault-Tolerant File Router    │
│  - Dependency DAG Engine               - Crash Recovery Watchdog       │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                            Stdio / │Local SSE
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                    ATLAS FAST-MCP PROTOCOL SERVER                      │
│  - claim_next_task()                   - submit_for_review()           │
│  - propose_task() [Inbox Pipeline]     - log_task_progress()           │
└───────────────────┬────────────────────────────────┬───────────────────┘
                    │                                │
            MCP IPC │Session 1               MCP IPC │Session 2
                    ▼                                ▼
┌───────────────────────────────────┐┌───────────────────────────────────┐
│     AI AGENT: PROJECT "ALPHA"     ││      AI AGENT: PROJECT "BETA"     │
│   (e.g., Claude Code in Repo A)   ││  (e.g., Copilot Autopilot in B)   │
└───────────────────────────────────┘└───────────────────────────────────┘
```

### Core Tenets
1. **Zero Human Idle Time:** The developer never waits on terminal generation; task definitions and visual annotations are pre-queued into an priority-weighted intake pipeline.
2. **Deterministic Autonomous Boundaries:** Agents cannot wander outside assigned scopes. Unrelated bugs found during work are routed into an approval-gated triage buffer rather than breaking current branch state.
3. **Hardware & Power Fault Tolerance:** Crash-proof state recovery using SQLite WAL mode, lease-based locking, and atomic disk writes guarantees zero data corruption during unexpected power cuts or network drops.
4. **Token Economics First:** Minimizes agent context bloat through strict schema trimming, absolute local file path passing (avoiding multimodal base64 re-encoding), and surgical delta updates.

---

## 2. Visual Design System & Command HUD Aesthetic

The interface adapts a high-density, mission-critical Tactical SOC (Security Operations Center) and Cybernetic HUD aesthetic derived from holographic command interfaces and real-time telemetry consoles.

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│ [≡] ATLAS COMMAND CENTER | MULTI-AGENT SOC                        [SYS: OPTIMAL] [11:42:09] [⚙]  │
├──────────────────────────────┬───────────────────────────────────┬───────────────────────────────┤
│ ACTIVE WORKSPACES            │ TELEMETRY & QUEUE RADAR           │ GLOBAL AGENT ACTIVITY STREAM  │
│ ┌──────────────────────────┐ │   PRIORITY MATRIX (2D SCATTER)    │ 11:41:02 [Alpha] Compiling... │
│ │ PROJ-ABC        94% ACTV │ │   100% ┼   ● Task-42 (P=96%)      │ 11:41:20 [Alpha] DoD Check #2 │
│ │ Root: /dev/core-backend  │ │        │       ▲                  │ 11:41:55 [Beta]  Diff Created │
│ ├──────────────────────────┤ │    50% │   ● Task-18              │ 11:42:01 [Beta]  Review Gate  │
│ │ PROJ-XYZ        78% IDLE │ │        │                          │                               │
│ │ Root: /dev/client-web    │ │     0% ┴─────────■───────────     │ [⚡ 2 DISCOVERIES AWAITING]   │
│ └──────────────────────────┘ │        0h       Age        12h    │                               │
├──────────────────────────────┴───────────────────────────────────┴───────────────────────────────┤
│ DUAL SPLIT AGENT WORKBENCH                                                                       │
│ ┌─ PROJECT: ALPHA (Active: Agent-Claude) ───────────┐ ┌─ PROJECT: BETA (Active: Agent-Copilot) ──┐ │
│ │ [TASK-104: Fix JWT Expiry Race Condition] (95%)   │ │ [TASK-201: Responsive Grid Collapse] (82%)│ │
│ │ ├─ DoD: [x] Repro Test  [x] Mutex  [ ] Migrations │ │ ├─ DoD: [x] CSS Breakpoints  [ ] Playwright│ │
│ │ ├─ Attachment: [screenshot_annotated_v2.png]      │ │ ├─ Attachment: [canvas_mockup.png]       │ │
│ │ └─ LIVE AGENT LOG STREAM:                         │ │ └─ LIVE AGENT LOG STREAM:                │ │
│ │    > claims lease #8f12a (valid 15m)              │ │    > inspecting DOM tree via selector    │ │
│ │    > running: pytest tests/auth/ -k "race"        │ │    > subtask spawned: #201.1 (Tokens)    │ │
│ └───────────────────────────────────────────────────┘ └──────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### 2.1 Color Palette Specifications
* **Canvas / Background Space:** Deep Cyber Obsidian (`#030712`) with secondary elevation panels in Subdued Navy/Slate (`#060D1F` and `#0B1528`).
* **Borders & Dividers:** Subtle luminous slate gridlines (`#1E293B`) with high-tech corner accents.
* **Primary Luminous Accent (Active / Flow / Identity):** Electric Cyan / Neon Teal (`#00F2FE` and `#00C9FF`), used for primary telemetry, active nodes, and data streams.
* **Review & Decision Accent (Human Gates / Approvals):** Radiant Cyber Amber (`#F59E0B` and `#FF9100`), used for verification gates, `PENDING_APPROVAL` discovery alerts, and manual overrides.
* **Success / Operational Accent:** Emerald Mint (`#10B981`), used for `COMPLETED` tasks, passing test suites, and healthy daemon pings.
* **Critical / Blocker Accent:** Crimson Coral (`#EF4444` and `#FF5252`), used for failed builds, lease timeouts, and priority scores $\ge 90\%$.

### 2.2 Typography & HUD Elements
* **Data & Monospace:** `JetBrains Mono` or `Geist Mono` for all task IDs, file paths, telemetry metrics, and log streams.
* **UI & Headings:** `Inter` or `Geist Sans` in medium/semibold tracking for operational panels.
* **Segmented Gauges:** Linear progress bars split into distinct LED-style blocks representing Definition of Done (DoD) completion percentages.
* **Glassmorphic Paneling:** Background blur (`backdrop-blur-md`) with 1px border highlights simulating tactical field displays.

---

## 3. High-Efficiency Local Storage & Folder Topology

To ensure strict isolation between projects and clean multi-agent execution, the local filesystem serves as the primary ground truth for artifacts, raw inputs, and execution traces.

```
storage/
└── projects/
    └── {project_uuid}/                        # Deterministic UUIDv4
        ├── project_meta.json                  # Slug, local repository path, global rules
        ├── project_audit.log                  # Append-only chronological system event log
        └── tasks/
            └── {task_uuid}/                   # Unique task working directory
                ├── meta.json                  # Mirror of DB record for offline recovery
                ├── input/                     # Human input assets
                │   ├── raw_screenshot_01.png
                │   ├── annotated_canvas.png   # Export from Next.js Fabric/Canvas tool
                │   └── user_context.md
                ├── output/                    # Agent generated artifacts
                │   ├── git_patch.patch        # Unified diff submitted by agent
                │   ├── test_execution.log     # Test stdout/stderr captures
                │   └── verification.png       # Playwright/browser verification snapshots
                └── execution.log              # Real-time streamed agent execution events
```

---

## 4. Token Efficiency & Context Optimization Architecture

Passing raw task histories, verbose JSON schemas, and multi-megabyte base64 images destroys agent context windows and inflates token overhead. The system implements a **Strict Token Conservation Engine**:

### 4.1 Zero-Base64 Multimodal Reference Protocol
* CLI agents running on the host machine have local filesystem access.
* Rather than base64-encoding images into tool payloads (which costs $\approx 1{,}500$ to $4{,}000$ tokens per image), the MCP server delivers **direct, absolute filesystem paths** (e.g., `/Users/dev/atlas/storage/.../input/annotated.png`).
* The agent reads or views the file via native local capabilities without inflating the MCP message buffer.

### 4.2 Compact Field Projections (Trimmed JSON Payloads)
* `claim_next_task` and `get_available_tasks` strip all internal system metadata (foreign keys, timestamps, audit trails).
* The returned payload contains only what the agent needs to write code: Title, Context, Checklist Array, and Target Repo Path.

### 4.3 Log Delta Truncation & Summarization
* Agents push logs via `log_task_progress`. Django writes these directly to disk (`execution.log`) and pipes them via SSE to the web HUD.
* The MCP server **never reflects the accumulated log history back to the agent**. The agent receives a 2-byte confirmation: `{"ok":true}`. This prevents log echo loops in context memory.

```
Token Waste Anti-Pattern (Base64 Inlining):
[Agent Prompt] <--- Base64 (~4,500 tokens) <--- [MCP Server] (High Cost, Slow)

ATLAS Optimized Pattern (Direct Local Resolution):
[Agent Tool]   <--- Absolute Path (18 tokens) <--- [MCP Server]
      │
      └───> Directly loads /storage/.../input.png via host vision engine
```

---

## 5. Fault-Tolerance, Crash Recovery & Interruption Protocol

The system is architected to operate continuously through abrupt hardware power failures, operating system crashes, or network dropouts.

```
                  SUDDEN HOST REBOOT / CRASH
                              │
                              ▼
                [Django Server Boot Sequence]
                              │
                              ▼
           [Execute: Recovery Watchdog Routine]
                              │
       ┌──────────────────────┴──────────────────────┐
       ▼                                             ▼
[Inspect SQLite WAL]                      [Inspect Task Leases]
PRAGMA journal_mode=WAL                   Find status == IN_PROGRESS
PRAGMA integrity_check                    Where lease_expires_at < NOW
       │                                             │
       ▼                                             ▼
Clean journal replay; zero locks          Revert task status to PENDING
                                          Append crash note to audit log
                                          Wipe orphan assigned_agent_id
```

### 5.1 SQLite WAL Mode & Durability Engine
* Django's database connection initializes with Write-Ahead Logging (`WAL`), `synchronous = NORMAL`, and a 5000ms busy timeout.
* WAL ensures that even if power cuts in the middle of a transaction, uncommitted frames are safely rolled back on the next process launch without database corruption.

### 5.2 Atomic Lease-Based Task Allocation
* No task is ever locked permanently. When an agent claims a task, the server grants a 15-minute lease:
  $$\text{lease\_expires\_at} = t_{\text{current}} + 15\text{ minutes}$$
* The agent must ping `task_heartbeat(task_id)` every 2 minutes.
* If a power outage terminates the agent CLI, the lease naturally expires.
* **Boot-Time Janitor:** On startup, a Django system check scans for expired `IN_PROGRESS` tasks, appends a `[SYSTEM CRASH DETECTED]` entry to `execution.log`, and cleanly returns the task to `PENDING` status.

### 5.3 Atomic Disk File Writes
* All files, logs, and patches written to `storage/` are buffered into a temporary file (`filename.tmp`).
* The file descriptor is synced to physical media via `os.fsync()`, then moved atomically into place using `os.replace()`. This prevents truncated, zero-byte images or broken diff files.

---

## 6. The 12 Foundational Functional Capabilities

The platform implements exactly 12 tightly integrated features:

1. **Atomic Claim Protocol (`claim_next_task`):** Concurrency-safe task locking. Uses database-level row locking (`select_for_update`) to prevent two parallel agents from acquiring the same task.
2. **Definition of Done (DoD) Checklists:** Structured JSON array of verifiable tasks (e.g., unit test written, documentation updated). Agents mark items off sequentially using discrete tool calls.
3. **Verification Gates (`submit_for_review`):** The agent cannot set status to `COMPLETED`. It must submit an atomic git patch and test run output, placing the task in `IN_REVIEW` for final human sign-off.
4. **Subtask Spawning (`spawn_subtask`):** If an agent discovers that a task requires architectural decomposition, it can spawn child subtasks that inherit priority weighting and auto-link to the parent.
5. **Dependency Blocking (`blocked_by`):** Directed Acyclic Graph (DAG) task engine. Tasks with unsatisfied prerequisites are completely invisible to `claim_next_task` queries.
6. **In-App Canvas Annotation:** Full Next.js visual annotation tool (bounding boxes, arrows, text callouts, privacy blurs) built on an HTML5 canvas over uploaded images, exporting flattened high-contrast visual guides for vision models.
7. **Cyber HUD Visual Theme:** High-density, dark OLED / Tactical SOC interface inspired by command centers and neural network telemetry.
8. **Split Multi-Agent Dashboard:** Responsive split-pane layout supporting simultaneous side-by-side management of Project ABC and Project XYZ, including independent terminal streams and queues.
9. **Live SSE Terminal Stream:** Server-Sent Events channel streaming agent progress events from Django directly into interactive terminal windows in the web HUD with zero page reloads.
10. **Keyboard-First Navigation (Vim/Linear style):** Full hotkey support (`J`/`K` list traversal, `C` new task, `A` approve discovery, `Space` preview asset, `/` search, `Esc` dismiss).
11. **Visual Priority Matrix:** Interactive 2D scatterplot view mapping Priority Percentage ($0\text{--}100\%$) along the Y-axis against Task Age / Dependency Weight on the X-axis for visual triage.
12. **Project Root Detection:** Projects store explicit absolute local directory paths. The MCP server automatically includes this root in task context, allowing agents to orient their working directories automatically.

---

## 7. The Agent Discovery Pipeline (`PENDING_APPROVAL`)

To maintain clean task scopes without ignoring newly discovered codebase anomalies, agents utilize the Discovery Pipeline:

```
┌────────────────────────────────────────────────────────────────────────┐
│ AGENT EXECUTION TRACE (Current Task #104)                              │
│ "Found deprecated auth middleware breaking on Node 22 during tests"    │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼ MCP Tool Invocation
┌────────────────────────────────────────────────────────────────────────┐
│ propose_task(                                                          │
│   project_slug="alpha",                                                │
│   title="Migrate Auth Middleware to Node 22 API",                      │
│   suggested_priority=85,                                               │
│   reason="Discovered deprecation warning during Task #104 test run",   │
│   screenshot_paths=["/storage/.../output/depr_warning.png"]            │
│ )                                                                      │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼ Stored in Database
┌────────────────────────────────────────────────────────────────────────┐
│ Task Record Created:                                                   │
│   status = "PENDING_APPROVAL"                                          │
│   is_agent_discovered = True                                           │
│   (COMPLETELY HIDDEN from claim_next_task() queue)                     │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼ SSE Signal to Frontend
┌────────────────────────────────────────────────────────────────────────┐
│ NEXT.JS COMMAND HUD: TACTICAL DISCOVERY INBOX                          │
│ [⚡ ALERT: 1 New Discovery from Agent-Claude]                          │
│                                                                        │
│ Options:                                                               │
│   [Enter] Approve (Promotes to PENDING with priority 85%)              │
│   [E]     Edit (Adjust priority slider, refine description)            │
│   [Del]   Dismiss / Reject                                             │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 8. Complete System State Machine

Every task transitions through a strictly validated lifecycle:

```
                  ┌────────────────────────┐
                  │   AGENT DISCOVERY      │
                  └───────────┬────────────┘
                              │ propose_task()
                              ▼
                  ┌────────────────────────┐
  Human Created ─>│    PENDING_APPROVAL    │
                  └───────────┬────────────┘
                              │ Human Approval via UI
                              ▼
                  ┌────────────────────────┐
       ┌─────────>│        PENDING         │<─────────┐
       │          └───────────┬────────────┘          │
       │                      │ claim_next_task()     │
       │ Lease Timeout /      ▼                       │ Rejection /
       │ Failure Reset   ┌────────────────────────┐   │ Rework
       └─────────────────┤      IN_PROGRESS       │   │
                         └───────────┬────────────┘   │
                                     │ submit_for_review()
                                     ▼                │
                         ┌────────────────────────┐   │
                         │       IN_REVIEW        ├───┘
                         └───────────┬────────────┘
                                     │ Human Sign-Off (Cmd+Enter)
                                     ▼
                         ┌────────────────────────┐
                         │       COMPLETED        │
                         └────────────────────────┘
```

---

## 9. FastMCP Interface Contract Specification

The interface between autonomous agents and the Django core is mediated via pure JSON tool contracts over the Model Context Protocol.

### 9.1 `claim_next_task`
```json
{
  "name": "claim_next_task",
  "description": "Claims the highest priority available pending task for a specific project. Automatically acquires a 15-minute lease.",
  "parameters": {
    "type": "object",
    "properties": {
      "project_slug": { "type": "string" },
      "agent_identifier": { "type": "string" },
      "min_priority": { "type": "integer", "minimum": 0, "maximum": 100, "default": 0 }
    },
    "required": ["project_slug", "agent_identifier"]
  },
  "returns": {
    "type": "object",
    "properties": {
      "task_id": { "type": "string" },
      "title": { "type": "string" },
      "description": { "type": "string" },
      "priority": { "type": "integer" },
      "local_repo_path": { "type": "string" },
      "definition_of_done": { 
        "type": "array", 
        "items": { 
          "type": "object", 
          "properties": { 
            "id": { "type": "integer" }, 
            "label": { "type": "string" }, 
            "completed": { "type": "boolean" } 
          } 
        } 
      },
      "attached_images": { 
        "type": "array", 
        "items": { "type": "string", "description": "Absolute filesystem paths" } 
      }
    }
  }
}
```

### 9.2 `propose_task`
```json
{
  "name": "propose_task",
  "description": "Proposes an out-of-scope bug, regression, or technical improvement discovered while working on an assigned task. Places the item into human triage.",
  "parameters": {
    "type": "object",
    "properties": {
      "project_slug": { "type": "string" },
      "title": { "type": "string" },
      "description": { "type": "string" },
      "suggested_priority": { "type": "integer", "minimum": 0, "maximum": 100 },
      "discovered_during_task_id": { "type": "string" },
      "screenshot_paths": {
        "type": "array",
        "items": { "type": "string" }
      }
    },
    "required": ["project_slug", "title", "description", "suggested_priority", "discovered_during_task_id"]
  }
}
```

### 9.3 `submit_for_review`
```json
{
  "name": "submit_for_review",
  "description": "Submits a claimed task for human verification with git patch and test run output. Releases the lease and sets status to IN_REVIEW.",
  "parameters": {
    "type": "object",
    "properties": {
      "task_id": { "type": "string" },
      "summary_of_work": { "type": "string" },
      "git_patch": { "type": "string", "description": "Unified git diff of changes" },
      "verification_log": { "type": "string", "description": "Stdout summary of test suite pass" }
    },
    "required": ["task_id", "summary_of_work", "git_patch"]
  }
}
```

### 9.4 `log_task_progress`
```json
{
  "name": "log_task_progress",
  "description": "Streams execution progress events to the live HUD terminal via SSE without consuming agent context memory.",
  "parameters": {
    "type": "object",
    "properties": {
      "task_id": { "type": "string" },
      "message": { "type": "string" },
      "level": { "type": "string", "enum": ["DEBUG", "INFO", "WARN", "ERROR"], "default": "INFO" }
    },
    "required": ["task_id", "message"]
  }
}
```

---

## 10. Agent Operating Protocol & Workspace Prompt

The following standard operating contract is injected into agent workspaces (via `.github/copilot-instructions.md` or `CLAUDE.md`):

```markdown
# ATLAS Autonomous Agent Execution Rules

1. MANDATORY CLAIM: You must never execute changes in this repository without first calling `claim_next_task(project_slug, agent_identifier)`.
2. WORKING DIRECTORY: Check the returned `local_repo_path` and verify your shell is operating at that root.
3. SCOPE CONTAINMENT: Focus exclusively on fulfilling the task description and `definition_of_done`. 
4. OUT-OF-SCOPE ANOMALIES: If you encounter existing bugs, broken tests, or deprecated dependencies unrelated to your task:
   - DO NOT fix them in your active branch.
   - Call `propose_task(...)` with clear reproduction steps and error logs.
   - Continue immediately with your assigned task.
5. PROGRESS REPORTING: Fire `log_task_progress(...)` at each significant milestone (e.g., test reproduction, fix implementation, verification).
6. VERIFICATION GATE: Before completing a task, execute the project test runner. Once passing, call `submit_for_review(...)` with your git patch. Do not attempt to merge directly into main.
```

---

## 11. Implementation Roadmap: The 10-Document Series & Subagent Execution Matrix

To implement ATLAS-MCP rapidly using concurrent AI subagents, the technical plan is divided into a **10-Document Series**. Each document is fully self-contained, specifies rigid interface contracts, and is assigned to isolated subagents to completely prevent merge conflicts or cross-boundary discrepancies.

```
                      SERIES DEPENDENCY GRAPH
                      
                           [Doc 01: Core Architecture]
                                      │
            ┌─────────────────────────┴─────────────────────────┐
            ▼                                                   ▼
[Doc 02: Database & Storage Engine]               [Doc 05: Visual HUD Design System]
            │                                                   │
    ┌───────┴───────┐                                   ┌───────┴───────┐
    ▼               ▼                                   ▼               ▼
[Doc 03: Fault] [Doc 04: Django]                 [Doc 06: Next.js] [Doc 07: Canvas]
[  Tolerance  ] [  Rest API    ]                 [  Dashboard    ] [  Annotation  ]
    │               │                                   │               │
    └───────┬───────┘                                   └───────┬───────┘
            ▼                                                   ▼
    [Doc 08: MCP Protocol Server]               [Doc 09: Live SSE Terminal Stream]
            │                                                   │
            └─────────────────────────┬─────────────────────────┘
                                      ▼
                        [Doc 10: E2E Integration & Verification]
```

### Document Series Breakdown & Worker Assignment

| Document Index | Document Title & Target Filename | Scope & Responsibilities | Subagent Allocation | Conflict Prevention Boundary |
| :--- | :--- | :--- | :--- | :--- |
| **Doc 01** | **System Architecture & Data Contracts**<br>`01_system_architecture.md` | Global interface schemas, unified JSON models, directory trees, and environment specifications. | **Subagent 1** (Lead Architect) | Serves as the single immutable source of truth; no other subagent may modify schemas. |
| **Doc 02** | **Database Models & Storage File Router**<br>`02_database_storage_engine.md` | Django ORM models (`Project`, `Task`, `ChecklistItem`, `Asset`), migrations, UUID folder manager. | **Subagent 2** (Backend Engine) | Confined strictly to `backend/core/models/` and `backend/core/storage.py`. |
| **Doc 03** | **Fault Tolerance & Recovery Watchdog**<br>`03_fault_tolerance_recovery.md` | SQLite WAL configurations, atomic lease management, lease timeouts, and boot janitor routines. | **Subagent 3** (Reliability Specialist) | Confined to `backend/core/recovery.py` and Django app startup hooks (`apps.py`). |
| **Doc 04** | **Django Core REST & Triage API**<br>`04_django_rest_api.md` | Endpoints for task CRUD, priority percentage updating, discovery triage inbox, and asset serving. | **Subagent 4** (API Developer) | Confined strictly to `backend/api/` views, serializers, and URL routing. |
| **Doc 05** | **Tactical Cyber-HUD Design System**<br>`05_hud_design_system.md` | Tailwind CSS configuration, obsidian/cyan/amber theme tokens, segmented progress bars, and HUD panels. | **Subagent 5** (Design Engineer) | Confined to `frontend/styles/`, `tailwind.config.js`, and atomic UI component primitives. |
| **Doc 06** | **Next.js Dual Split-Board Dashboard**<br>`06_nextjs_dashboard.md` | Split multi-agent layout, project workspace switcher, Linear-style keyboard hotkeys, priority matrix scatterplot. | **Subagent 6** (Frontend Core) | Confined to `frontend/app/` page layouts, board components, and keyboard hooks. |
| **Doc 07** | **In-App Canvas Annotation Engine**<br>`07_canvas_annotation_engine.md` | HTML5 canvas image overlay, arrow/box/blur markup tools, flattened PNG export and storage upload pipeline. | **Subagent 7** (Canvas Specialist) | Confined strictly to `frontend/components/canvas/` and annotation utility classes. |
| **Doc 08** | **FastMCP Protocol Server & Tools**<br>`08_mcp_server_protocol.md` | FastMCP Python server, tool definitions (`claim`, `propose`, `submit`, `log`), and direct path resolvers. | **Subagent 8** (MCP Protocol Lead) | Confined strictly to `mcp_server/` directory and tool handler functions. |
| **Doc 09** | **Real-Time SSE Event & Terminal Stream**<br>`09_realtime_terminal_sse.md` | Django SSE streaming generators, Next.js terminal receiver, auto-scroll monospace logs, and sound effects. | **Subagent 9** (Streaming Specialist) | Confined to `backend/api/sse.py` and `frontend/components/terminal/`. |
| **Doc 10** | **End-to-End Testing & Verification Suite**<br>`10_e2e_verification_harness.md` | Multi-agent simulation tests, power cut recovery simulation, mock CLI agent runners, and acceptance scripts. | **Subagent 10** (QA & Validation) | Confined strictly to `tests/e2e/`, `scripts/`, and integration test harnesses. |

### Subagent Parallel Execution Rules
1. **Schema Freeze:** Subagents 2 through 9 cannot alter the JSON contracts defined in Doc 01. Any missing parameter must be flagged via review rather than ad-hoc schema modification.
2. **Path Ownership Isolation:** Subagents work exclusively within their assigned directories. Backend subagents cannot touch `frontend/`, and MCP subagents cannot touch Django model files directly (they interact solely via Django ORM or internal service APIs).
3. **Mock Dependencies:** Frontend subagents (Doc 06, 07, 09) develop against the JSON mock responses specified in Doc 01, allowing them to proceed simultaneously with backend subagents (Doc 02, 03, 04).