---
name: aos
version: 3.1.0
description: "AOS v3.1 (Safe-Merge Protocol). Unified Agent Operating System merging Execution (Dispatch), Organization (Roles), Cognition (Self-Improving), and Safety (Sandbox/Merge)."
user-invocable: true
---

# Agent Orchestration System (AOS) v3.1

The **Evolutionary Orchestrator**. This skill merges execution protocols with cognitive reflection, enabling the system to learn from every action, while enforcing strict safety boundaries through a Sandbox-Review-Merge workflow.

## 1. CLI Reference (User Interface)

This skill turns Telegram `/aos ...` into a **Supervisor + Orchestrator** interface.

**Core shift:** `/aos <nl>` is NOT “run a one-shot pipeline”. It is a **goal-closed loop contract**: God keeps coordinating until **DoD is satisfied** (auto-safe: auto-DONE when objectively verifiable; ask only when uncertain/risky).

### Subcommands

#### 0) **<nl> / auto** (Pilot Mode)
- `/aos <natural language requirement>`
- `/aos auto <natural language requirement>`

**Behavior**:
- **Sense**: Converts NL → a Contract `{goal, scope, constraints, dod[], risks}`.
- **Act**: Creates a root contract task and immediately triggers the closed-loop cycle.
- **Loop**: Auto-Decompose (COO) → Auto-Execute (CTO) → Auto-Review (Reviewer) → Auto-Merge.

#### 1) **status** (Dashboard)
- `/aos status`
- `/aos status --taskId=#...`

**Behavior**:
- Shows the current system state: In Progress tasks, Review queue, and health metrics.
- Prioritizes the authoritative snapshot projection.

#### 2) **sprint** (Cycle Management)
- `/aos sprint`

**Behavior**:
- Forces one closed-loop step: `queue_sync` → `heartbeat_full` → `aggregate` (DoD check) → `contract_complete`.
- Generates a burn-down report for the current active sprint/contract.

#### 3) **review** (Gatekeeper)
- `/aos review`

**Behavior**:
- Aggregates evidence (screenshots, logs) for pending contracts.
- Sends key evidence to Telegram for manual inspection if needed.

#### 4) **task** (Manual Entry)
- `/aos task <natural language requirement>`

**Behavior**:
- Creates a task in `Ready` state but **does not** trigger the heartbeat immediately.
- Use this to build a backlog.

#### 5) **doctor** (Health Check)
- `/aos doctor`

**Behavior**:
- Deep inspection of the event log, snapshot integrity, and dedupe index.

---

## 2. Architecture: The 7-Step Lifecycle (Kernel)

AOS v3.1 operates on a rigorous cognitive and execution cycle:

1.  **Sense (Heartbeat)**: Scan `tasks/QUEUE.md` for `#ready` tasks.
2.  **Recall (Wisdom)**: Query `memory/aos/patterns.md` (Hot Memory) for relevant experience.
    - *Auto-Trigger*: On `Retry > 1` or `Priority P0`.
    - *Injection*: Wisdom is injected into the Agent's System Prompt.
3.  **Decompose (Plan)**: `God` consults `COO` to break complex goals into **Parallel Tasks**.
    - *Automation*: `plan_apply.js` effector automatically creates child tasks from `COO` plans.
4.  **Draft (Act)**: `CTO`/`CMO` execute in **Sandbox Mode**.
    - *Constraint*: **Read-Only** access to `repos/`. **Write-Only** access to `artifacts/`.
5.  **Review (Gatekeeper)**: `Reviewer` Agent inspects artifacts.
    - *Standard*: Strict DoD (Compile, Test, Valid JSON).
    - *Automation*: `auto_review.js` effector can auto-approve low-risk tasks (status=success).
    - *Decision*: `Approved` or `Rejected` (with specific feedback).
6.  **Merge (Commit)**: On `Approved`, `God` copies artifacts to `repos/`.
    - *Protocol*: `result.json` must contain a `merge` manifest.
7.  **Learn (Evolve)**: On `Rejected/Failed`, log the **Root Cause** to `memory/aos/corrections.md`.
    - *Effector*: `learn_apply.js` (Automated Learning).
    - *Loop*: The next attempt will Recall this lesson.

## 3. Dispatch v3 Protocol (Execution)

- **Single Source of Truth**: `workflow-events.jsonl` is law.
- **God is Writer**: Only God writes events/state. Sub-agents are read-only sensors.
- **Atomic Updates**: Dispatch results must be committed atomically.

## 4. Team Roles (Organization)

Defined in `config/roles.json`.

| Role | Responsibility | Capability |
|------|----------------|------------|
| **God** | Orchestrator, Decision, Memory | `write_workflow`, `dispatch`, `reflect`, `merge` |
| **COO** | Planner, Scheduler | `read_only_runner` (Parallel Decomposition) |
| **CTO** | Builder, Architect | `read_only_runner` (Sandbox Execution) |
| **CMO** | Strategist, Content | `read_only_runner` (Sandbox Execution) |
| **Reviewer** | Gatekeeper, Auditor | `read_only_runner` (Strict DoD Check) |

## 5. File Structure

- **Kernel**: `skills/aos/scripts/core/` (Autopilot, Router)
- **Effectors**: `skills/aos/scripts/effectors/` (Heartbeat, Spawner, Notifier)
- **CLI**: `skills/aos/scripts/cli/` (Contract, Sprint, Status)
- **State**: `.aos/workflow-events.jsonl` (Source of Truth)
- **Memory**: `memory/aos/patterns.md` (Wisdom)

## 6. Safety & Reliability

- **Sandboxing**: Runners operate in `artifacts/<runId>/`.
- **Deterministic Merge**: `aos_merge.js` enforces strict source/target paths.
- **Side-Effect Isolation**: Deciders (`autopilot`) are pure; Effectors (`execute_actions`) are isolated.
