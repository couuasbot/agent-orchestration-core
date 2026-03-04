# Agent Orchestration Core (AOS)

The definitive Agent Operating System for OpenClaw. AOS merges event-sourced communication, role-based delegation, and autonomous drive into a single, cohesive skill.

## Features

- **Unified State Machine**: Single source of truth via `workflow-events.jsonl`.
- **Role-Based Orchestration**: Defines God (Orchestrator), COO (Planner), CTO (Builder), CMO (Strategist), Reviewer (Gatekeeper).
- **Event Sourcing**: Immutable event log for auditability and reliability.
- **Autonomous Drive**: Proactive heartbeat loop via `tasks/QUEUE.md`.
- **CLI Tools**: Robust scripts for queue sync, event dispatch, and system health checks.

## Installation

1.  **Clone or Download**:
    Place this folder in your OpenClaw skills directory (e.g., `~/.openclaw/workspace-god/skills/agent-orchestration-core`).

2.  **Dependencies**:
    This skill uses standard Node.js libraries. Ensure your OpenClaw environment has Node.js installed.

3.  **Configuration**:
    - `config/roles.json`: Define agent roles and permissions.
    - `config/lifecycle.json`: Customize task states and transitions.

4.  **Integration**:
    - Update your `HEARTBEAT.md` to reference the AOS scripts (see `SKILL.md` for details).
    - Setup a cron job to run `scripts/system_check.js` periodically.

## Usage

### Task Management

Add tasks to `tasks/QUEUE.md`:
```markdown
- [ ] Refactor auth module #ready
```

### CLI Commands

- **Sync Queue**:
  ```bash
  node scripts/queue_sync.js
  ```
- **Dispatch Event**:
  ```bash
  node scripts/dispatch_router.js --type=DISPATCH --payload='{"taskId": "#123", ...}'
  ```

## License

MIT
