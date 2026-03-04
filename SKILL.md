---
name: agent-orchestration-system
version: 2.0.0
description: "AOS v2 (Cognitive Edition). Unified Agent Operating System merging Execution (Dispatch), Organization (Roles), and Cognition (Self-Improving)."
---

# Agent Orchestration System (AOS) v2

The **Evolutionary Orchestrator**. This skill merges execution protocols with cognitive reflection, enabling the system to learn from every action.

## 1. Architecture: The Cognitive Loop

AOS v2 operates on a 6-step cognitive cycle:

1.  **Sense (Heartbeat)**: Scan `tasks/QUEUE.md` for `#ready` tasks.
2.  **Recall (Wisdom)**: Query `memory/aos/patterns.md` (Hot Memory) + `memory/aos/corrections.md` (Warm Memory) for relevant experience.
    - *Command*: `node scripts/reflect.js --action=recall --query="<keywords>"`
3.  **Plan (Roles)**: Assign work to God/COO/CTO/CMO based on capability.
4.  **Act (Dispatch)**: Execute via `dispatch_router.js`.
5.  **Reflect (Insight)**: After task completion, evaluate the outcome.
    - *Question*: "What worked? What failed? Is this a recurring pattern?"
6.  **Evolve (Memory)**: Log lessons to `memory/aos/corrections.md` (Warm Memory).
    - *Command*: `node scripts/reflect.js --action=learn --lesson="<insight>"`

## 2. Dispatch v2 Protocol (Execution)

- **Single Source of Truth**: `workflow-events.jsonl` is the immutable log.
- **God is Writer**: Only God writes events/state. Sub-agents are read-only sensors.
- **Atomic Updates**: Dispatch results must be committed atomically.

## 3. Team Roles (Organization)

Defined in `config/roles.json`.

| Role | Responsibility | Capability |
|------|----------------|------------|
| **God** | Orchestrator, Decision, Memory | `write_workflow`, `dispatch`, `reflect` |
| **COO** | Planner, Scheduler | `read_only_runner` |
| **CTO** | Builder, Architect | `read_only_runner` |
| **CMO** | Strategist, Content | `read_only_runner` |
| **Reviewer** | Gatekeeper, Auditor | `read_only_runner` |

## 4. CLI Reference

### AOS Doctor (Health Check)

```bash
node scripts/aos_doctor.js
```

Produces a human-readable markdown report covering event log size, snapshot lag, dedupe index status, and any In Progress / Review tasks.


### A. Cognitive Operations (New in v2)

**Recall Patterns (Before Action)**:
```bash
node scripts/reflect.js --action=recall --query="deploy"
```

**Log Lessons (After Action)**:
```bash
node scripts/reflect.js --action=learn --lesson="Always check disk space before build"
```

### B. Execution Operations

**Sync Queue**:
```bash
node scripts/queue_sync.js
```

**Dispatch Task**:
```bash
node scripts/dispatch_router.js --type=DISPATCH --payload='{"taskId": "#123", ...}'
```

**Complete Task**:
```bash
node scripts/dispatch_router.js --type=TASK_COMPLETE --payload='{"taskId": "#123", "status": "DONE"}'
```

## 5. Memory Structure

- `memory/aos/patterns.md`: Core, verified patterns (Hot Memory).
- `memory/aos/corrections.md`: Recent lessons and feedback (Warm Memory).
- `memory/domains/`: Domain-specific knowledge (Cold Memory).

## 6. Run Isolation & Strong Binding (Reliability)

AOS uses two protections to prevent stale artifacts from incorrectly completing a task:

- **Scheme A (Strong binding):** each runner must write `runId` into `result.json`, and the orchestrator will only accept results whose `runId` matches the most recent `DISPATCH.runId`.
- **Scheme B (Directory isolation):** artifacts are written under `<artifactsBaseDir>/<runId>/` so each attempt is naturally separated.

## 6.5 Two-Lane Concurrency (Execution vs Ops)

To keep the system responsive, AOS supports two independent concurrency lanes:

- **Execution lane** (`lane=execution` / `#exec`): code changes, tests, heavy work (default concurrency 1)
- **Ops lane** (`lane=ops` / `#ops`): queue sync/doctor/notifications/index repair (default concurrency 2)

`autopilot.js` parameters:
- `--maxConcurrency=<n>`: execution lane concurrency
- `--opsConcurrency=<n>`: ops lane concurrency

## 7. Dedupe Index & Incremental Snapshots (Performance/Reliability)

To keep AOS fast and idempotent as the event log grows:

- **Dedupe index:** `.aos/dedupe-index.json` records `(TYPE::dedupeKey)` so `dispatch_router.js` can reject duplicates in O(1) without scanning the full log.
- **Incremental task snapshot:** `.aos/workflow-snapshot.json` stores the projected task map plus a byte `offset` into `workflow-events.jsonl`, allowing `queue_sync.js` and `autopilot.js` to process only newly appended events.

## 8. Reference
- **Config**: `config/roles.json`, `config/lifecycle.json`
- **Logs**: `workflow-events.jsonl`
