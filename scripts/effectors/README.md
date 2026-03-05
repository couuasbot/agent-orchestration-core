# AOS Effectors

**Principle:** `dispatch_router.js` is intentionally *pure* (validate + appendEvent). Any side-effectful automation lives here.

Typical effectors:
- `aos_merge.js`: apply `result.json.merge[]` to `repos/` (audit via `AOS_MERGE` events)
- `execute_actions.js`: translate autopilot `actions[]` into event writes + `AOS_SPAWN_REQUEST` + `NOTIFY_REQUEST`
- `spawn_runner.js`: fulfill `AOS_SPAWN_REQUEST` by running the requested isolated agent via `openclaw agent`
- `notifier.js`: translate `NOTIFY_REQUEST` -> send chat message -> write `NOTIFY_SENT`
