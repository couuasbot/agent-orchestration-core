# Agent Orchestration System (AOS)

AOS is a deterministic **event-sourced orchestration loop** for OpenClaw.

- **Single source of truth:** `workflow-events.jsonl` (append-only)
- **Human view:** `tasks/QUEUE.md` (projection)
- **Controller:** `dispatch_router.js` (writes) + `queue_sync.js` (projection) + `autopilot.js` (decides)

For a detailed snapshot of the current system, see: **`STATE_OF_AOS.md`**.

## What’s in this repo

- `scripts/`
  - `autopilot.js`: produces deterministic actions (spawn/complete/mismatch/stale/validation)
  - `dispatch_router.js`: appends validated events (idempotent via `payload.dedupeKey`)
  - `queue_sync.js`: renders `tasks/QUEUE.md`
- `schemas/`
  - `event.schema.json`: contract for each JSONL event
  - `result.schema.json`: contract for `result.json` written by runners
- `config/`: roles + lifecycle
- `cron/`: example cron job templates

## Key capabilities (current)

- **Strong binding (runId):** only accept `result.json` when `result.runId == latest DISPATCH.runId`
- **Per-run artifact isolation:** `<artifactsBaseDir>/<runId>/...`
- **Dedupe index:** `.aos/dedupe-index.json` for O(1) idempotency
- **Incremental snapshot:** `.aos/workflow-snapshot.json` for fast projections
- **Schema validation:** invalid events/results generate `VALIDATION_ERROR`
- **Global autopilot mutex:** `.aos/autopilot.lock` prevents cron overlap
- **Two-lane concurrency:** `execution` vs `ops` lanes for responsiveness

## Quickstart

Place this repo under your OpenClaw workspace skills directory:

```bash
~/.openclaw/workspace-god/skills/agent-orchestration-system
```

Run projection:
```bash
node scripts/queue_sync.js
```

Create a task:
```bash
node scripts/task_create.js --taskId=#demo-001 --title="Demo" --roleHint=cto --lane=execution
```

Run autopilot decision:
```bash
node scripts/autopilot.js --maxConcurrency=1 --opsConcurrency=2 --slaMinutes=60
```

## License

MIT
