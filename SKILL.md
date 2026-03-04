---
name: agent-orchestration-core
version: 2.0.0
description: "AOS v2 (Cognitive Edition). Unified Agent Operating System merging Execution (Dispatch), Organization (Roles), and Cognition (Self-Improving)."
---

# Agent Orchestration Core (AOS) v2

The **Evolutionary Orchestrator**. This skill merges execution protocols with cognitive reflection, enabling the system to learn from every action.

## 1. Architecture: The Cognitive Loop

AOS v2 operates on a 6-step cognitive cycle:

1.  **Sense (Heartbeat)**: Scan `tasks/QUEUE.md` for `#ready` tasks.
2.  **Recall (Wisdom)**: Query `memory/patterns.md` for relevant experience.
    - *Command*: `node scripts/reflect.js --action=recall --query="<keywords>"`
3.  **Plan (Roles)**: Assign work to God/COO/CTO/CMO based on capability.
4.  **Act (Dispatch)**: Execute via `dispatch_router.js`.
5.  **Reflect (Insight)**: After task completion, evaluate the outcome.
    - *Question*: "What worked? What failed? Is this a recurring pattern?"
6.  **Evolve (Memory)**: Log lessons to `memory/corrections.md`.
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

- `memory/patterns.md`: Core, verified patterns (Hot Memory).
- `memory/corrections.md`: Recent lessons and feedback (Warm Memory).
- `memory/domains/`: Domain-specific knowledge (Cold Memory).

## 6. Reference
- **Config**: `config/roles.json`, `config/lifecycle.json`
- **Logs**: `workflow-events.jsonl`
