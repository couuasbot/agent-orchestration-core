---
name: agent-orchestration-core
version: 1.0.1
description: "Unified Agent Operating System (AOS). Merges Dispatch v2 (Protocol), ATO (Roles), and Autonomy Kit (Drive). Manages the full lifecycle of autonomous tasks via event sourcing and role-based delegation."
---

# Agent Orchestration Core (AOS)

The central nervous system for OpenClaw. This skill consolidates communication protocols, team organization, and autonomous drive into a single operating model.

## 1. Architecture: The Trinity

AOS follows a Model-View-Controller (MVC) pattern to ensure state consistency:

- **View (Interaction)**: `tasks/QUEUE.md`
  - Human and Agent interface for tasks.
  - Read-only projection of the underlying state (for agents).
  - Human edits = Command injection.
- **Controller (Logic)**: `ATO Roles & Rules`
  - Defines who does what (God/COO/CTO/CMO).
  - Enforces the lifecycle (Ready -> In Progress -> Review -> Done).
- **Model (State)**: `workflow-events.jsonl`
  - The Single Source of Truth.
  - Append-only event log.
  - All status updates MUST be events.

## 2. Dispatch v2 Protocol (Event Sourcing)

We replaced file-based locking with event sourcing to prevent race conditions.

### The Golden Rules
1.  **God is the only Writer**: Only the God agent (Orchestrator) can write to `workflow-events.jsonl` or push to Git.
2.  **Sub-agents are Read-Only**: COO, CTO, and CMO run in `read-only` sessions. They analyze, plan, and generate code, but return results as JSON to God.
3.  **Atomic Updates**: God receives sub-agent results -> Commits Event -> Updates `QUEUE.md` (via adapter).

## 3. Team Roles (ATO)

Defined in `config/roles.json`.

| Role | Responsibility | Capability |
|------|----------------|------------|
| **God** | Orchestration, Decision, State Write | `write_workflow`, `git_push`, `dispatch` |
| **COO** | Planning, Scheduling, coordination | `read_only_runner` |
| **CTO** | Architecture, Code, Debugging | `read_only_runner` |
| **CMO** | Content, Messaging, Research | `read_only_runner` |
| **Reviewer** | Quality Assurance, Gatekeeping | `read_only_runner` |

## 4. CLI Reference (How to Execute)

**DO NOT edit `workflow-events.jsonl` manually.** Use these commands.

### A. Sync Queue (Before reading tasks)
Always run this first to ensure `tasks/QUEUE.md` reflects the latest events.
```bash
node scripts/queue_sync.js
```

### B. Dispatch a Runner (Start Task)
When you spawn a sub-agent, log the dispatch event:
```bash
node scripts/dispatch_router.js \
  --type=DISPATCH \
  --payload='{"taskId": "#task-001", "role": "cto", "intent": "Refactor Auth"}'
```

### C. Complete a Task (Finish)
When a sub-agent returns success, or you finish a task, log the completion. **This will auto-check the box in QUEUE.md.**
```bash
node scripts/dispatch_router.js \
  --type=TASK_COMPLETE \
  --payload='{"taskId": "#task-001", "status": "DONE", "artifacts": ["src/auth.ts"]}'
```

### D. Log an Agent Response (Intermediate)
If a sub-agent returns data but the task isn't done:
```bash
node scripts/dispatch_router.js \
  --type=AGENT_RESPONSE \
  --payload='{"taskId": "#task-001", "from": "cto", "content": "Analysis complete, requesting approval"}'
```

## 5. Autonomy Drive (The Loop)

The system is self-driving via the Heartbeat mechanism.

1.  **Tick**: Heartbeat triggers.
2.  **Sync**: Run `queue_sync.js`.
3.  **Sense**: Read `tasks/QUEUE.md` for `[ ] ... #ready` tasks.
4.  **Plan**: Route task to appropriate role (e.g., coding task -> CTO).
5.  **Act**: God spawns sub-agent to execute + Logs `DISPATCH` event.
6.  **Persist**: God logs `TASK_COMPLETE` event when done.

## 6. Reference
- **Config**: See `config/roles.json` and `config/lifecycle.json`.
- **Logs**: See `workflow-events.jsonl` in the workspace root.
