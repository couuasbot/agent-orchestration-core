# State of AOS (Agent Orchestration System)

**Status:** Live / running in production (OpenClaw workspace)

**Core idea:** Event-sourced orchestration with deterministic autopilot scheduling. `workflow-events.jsonl` is the single source of truth; `.aos/workflow-snapshot.json` is the authoritative incremental projection; `tasks/QUEUE.md` is a projection for humans only (must not drive decisions).

## Architecture (MVC)

- **Model:** `workflow-events.jsonl` (append-only event log)
- **View:** `tasks/QUEUE.md` (projected, human-readable queue)
- **Controller:** scripts in `scripts/`:
  - `dispatch_router.js` (write events, idempotent via dedupeKey)
  - `queue_sync.js` (projection renderer)
  - `autopilot.js` (deterministic decision engine)

## Reliability Guarantees

### Strong Binding (Run Isolation)

To prevent stale artifacts from completing the wrong attempt:

- **Scheme A:** Each runner must write `runId` into `result.json`. Orchestrator accepts results only when `result.runId == latest DISPATCH.runId`.
- **Scheme B:** Artifacts are isolated under `<artifactsBaseDir>/<runId>/`.

### Idempotency + Performance

- **Dedupe index:** `.aos/dedupe-index.json` stores `(TYPE::dedupeKey)` so repeated writes are O(1) and safe.
- **Incremental snapshot:** `.aos/workflow-snapshot.json` stores projected task map + byte offset into `workflow-events.jsonl` so projections only scan new events.

### Schema Validation

Two JSON Schemas define the contracts:

- `schemas/event.schema.json` — format of each JSONL event
- `schemas/result.schema.json` — runner output contract (`result.json`)

Enforcement:

- `dispatch_router.js` validates event inputs before append; on failure it writes `VALIDATION_ERROR`.
- `autopilot.js` validates `result.json`; malformed/invalid results emit an `action=validation_error` which should be recorded as `VALIDATION_ERROR` and the task moved to **Review**.

### Global Autopilot Mutex

`autopilot.js` uses a global lock file: `.aos/autopilot.lock` (pid/startTs/ttlMs).

- Fresh lock => noop (prevents cron overlap)
- Stale lock => recovered (`meta.lock.recoveredStale=true`) and should be recorded as `AUTOPILOT_STALE_LOCK_RECOVERED`

## Two-Lane Concurrency (Responsiveness)

AOS supports **two independent lanes** so ops work doesn’t get blocked by long execution tasks:

- **Execution lane** (`lane=execution`, tag `#exec`): code changes/tests/heavy work (default concurrency 1)
- **Ops lane** (`lane=ops`, tag `#ops`): queue sync/doctor/notifications/index repair (default concurrency 2)

`autopilot.js` parameters:
- `--maxConcurrency=<n>`: execution lane concurrency
- `--opsConcurrency=<n>`: ops lane concurrency
- `--maxTotalSpawns=<n>`: maximum spawns per heartbeat (allows 1 exec + 1 ops in one run)

## Operational Loop (Cron)

Recommended: run a periodic cron job that executes `queue_sync.js` first (human view refresh), then runs `autopilot.js`, and finally performs the returned actions (spawn/complete/mismatch/stale/validation). Decisions must rely on the snapshot/event projection, not QUEUE.md.

Notes:
- Prefer cron delivery `none` and use explicit notifications (deduped by NOTIFY_SENT) to avoid spam.
- Use hard timeouts (e.g. 240s) to keep scheduler healthy.

## Key Commands

```bash
# Project view (QUEUE.md)
node scripts/queue_sync.js

# Create a task
node scripts/task_create.js --taskId=#demo-001 --title="Demo" --roleHint=cto --lane=execution --slaMinutes=60

# Run autopilot (dry decision)
node scripts/autopilot.js --maxConcurrency=1 --opsConcurrency=2 --slaMinutes=60

# Write an event
node scripts/dispatch_router.js --type=TASK_STATE --payload='{"taskId":"#demo-001","state":"In Progress"}'
```
