---
name: agent-orchestration-system
version: 3.1.0
description: "AOS v3.1 (Safe-Merge Protocol). Unified Agent Operating System merging Execution (Dispatch), Organization (Roles), Cognition (Self-Improving), and Safety (Sandbox/Merge)."
---

# Agent Orchestration System (AOS) v3.1

The **Evolutionary Orchestrator**. This skill merges execution protocols with cognitive reflection, enabling the system to learn from every action, while enforcing strict safety boundaries through a Sandbox-Review-Merge workflow.

## 1. Architecture: The 7-Step Lifecycle

AOS v3.1 operates on a rigorous cognitive and execution cycle:

1.  **Sense (Heartbeat)**: Scan `tasks/QUEUE.md` for `#ready` tasks.
2.  **Recall (Wisdom)**: Query `memory/aos/patterns.md` (Hot Memory) for relevant experience.
    - *Auto-Trigger*: On `Retry > 1` or `Priority P0`.
    - *Injection*: Wisdom is injected into the Agent's System Prompt.
3.  **Decompose (Plan)**: `God` consults `COO` to break complex goals into **Parallel Tasks**.
4.  **Draft (Act)**: `CTO` / `CMO` execute in **Sandbox Mode**.
    - *Constraint*: **Read-Only** access to `repos/`. **Write-Only** access to `artifacts/`.
5.  **Review (Gatekeeper)**: `Reviewer` Agent inspects artifacts.
    - *Standard*: Strict DoD (Compile, Test, Valid JSON).
    - *Decision*: `Approved` or `Rejected` (with specific feedback).
6.  **Merge (Commit)**: On `Approved`, `God` copies artifacts to `repos/`.
    - *Protocol*: `result.json` must contain a `merge` manifest.
7.  **Learn (Evolve)**: On `Rejected/Failed`, log the **Root Cause** to `memory/aos/corrections.md`.
    - *Loop*: The next attempt will Recall this lesson.

## 2. Dispatch v3 Protocol (Execution)

- **Single Source of Truth**: `workflow-events.jsonl` is law.
- **God is Writer**: Only God writes events/state. Sub-agents are read-only sensors.
- **Atomic Updates**: Dispatch results must be committed atomically.

## 3. Team Roles (Organization)

Defined in `config/roles.json`.

| Role | Responsibility | Capability |
|------|----------------|------------|
| **God** | Orchestrator, Decision, Memory | `write_workflow`, `dispatch`, `reflect`, `merge` |
| **COO** | Planner, Scheduler | `read_only_runner` (Parallel Decomposition) |
| **CTO** | Builder, Architect | `read_only_runner` (Sandbox Execution) |
| **CMO** | Strategist, Content | `read_only_runner` (Sandbox Execution) |
| **Reviewer** | Gatekeeper, Auditor | `read_only_runner` (Strict DoD Check) |

## 4. CLI Reference

### AOS Doctor (Health Check)

```bash
node scripts/aos_doctor.js
```

Produces a human-readable markdown report covering event log size, snapshot lag, dedupe index status, and any In Progress / Review tasks.

### A. Cognitive Operations (New in v2/v3)

**Recall Patterns (Manual)**:
```bash
node scripts/reflect.js --action=recall --query="deploy"
```

**Log Lessons (Manual)**:
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

**Review a Task (Auto-Merge Trigger)**:
```bash
# Approve & Merge: records TASK_REVIEW + TASK_COMPLETE(DONE) + AOS_MERGE
node scripts/task_review.js --taskId=#123 --runId=run_xxx --reviewer=boss --decision=approved --notes="LGTM"

# Reject & Learn: records TASK_REVIEW + TASK_STATE(Ready) + AOS_LEARN
node scripts/task_review.js --taskId=#123 --runId=run_xxx --reviewer=boss --decision=rejected --notes="Tests failed" --nextState=Ready
```

## 5. Memory Structure

- `memory/aos/patterns.md`: Core, verified patterns (Hot Memory).
- `memory/aos/corrections.md`: Recent lessons and feedback (Warm Memory).
- `memory/domains/`: Domain-specific knowledge (Cold Memory).

## 6. Run Isolation & Safe Merge (Reliability)

AOS uses three protections to prevent stale artifacts or bad code from polluting the repo:

- **Scheme A (Strong binding):** each runner must write `runId` into `result.json`.
- **Scheme B (Directory isolation):** artifacts are written under `<artifactsBaseDir>/<runId>/`.
- **Scheme C (Review Gate + Safe Merge):** 
    - Agents generate code in `artifacts/`.
    - Reviewer approves.
    - God executes copy to `repos/` based on `result.json.merge` manifest.

## 6.5 Two-Lane Concurrency (Execution vs Ops)

To keep the system responsive, AOS supports two independent concurrency lanes:

- **Execution lane** (`lane=execution` / `#exec`): code changes, tests, heavy work (default concurrency 3, burst 5)
- **Ops lane** (`lane=ops` / `#ops`): queue sync/doctor/notifications/index repair (default concurrency 2)

`autopilot.js` parameters:
- `--maxConcurrency=<n>`: execution lane concurrency
- `--opsConcurrency=<n>`: ops lane concurrency

## 7. Dedupe Index & Incremental Snapshots (Performance/Reliability)

To keep AOS fast and idempotent as the event log grows:

- **Dedupe index:** `.aos/dedupe-index.json` records `(TYPE::dedupeKey)` so `dispatch_router.js` can reject duplicates in O(1) without scanning the full log.
- **Incremental task snapshot:** `.aos/workflow-snapshot.json` stores the projected task map plus a byte `offset` into `workflow-events.jsonl`.

## 8. Reference
- **Config**: `config/roles.json`, `config/lifecycle.json`
- **Logs**: `workflow-events.jsonl`
