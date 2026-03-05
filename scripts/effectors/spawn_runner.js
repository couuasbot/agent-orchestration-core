#!/usr/bin/env node

// Fulfill AOS_SPAWN_REQUEST events by running the requested isolated agent via OpenClaw CLI.
// This is the side-effect layer that actually runs the builder/planner/reviewer.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const { getWorkspaceRoot } = require('../lib/workspace');
const { acquireLock, releaseLock } = require('../lib/lock');
const { safeJsonParse } = require('../lib/util');
const { appendEvent } = require('../lib/event_log');

function arg(name, def = '') {
  const pfx = `--${name}=`;
  const hit = process.argv.slice(2).find(a => a.startsWith(pfx));
  if (!hit) return def;
  return hit.slice(pfx.length);
}

function loadDedupeIndex() {
  const root = getWorkspaceRoot();
  const p = path.join(root, '.aos', 'dedupe-index.json');
  try {
    const obj = JSON.parse(fs.readFileSync(p, 'utf8'));
    return obj && obj.entries ? obj : { entries: {} };
  } catch (_) {
    return { entries: {} };
  }
}

function main() {
  const root = getWorkspaceRoot();
  const max = Number(arg('max', '1'));
  const thinking = arg('thinking', 'minimal');
  const timeout = Number(arg('timeout', '600'));

  const lockPath = path.join(root, '.aos', 'spawn_effector.lock');
  let lock = null;
  try {
    lock = acquireLock(lockPath, { staleMs: 20 * 60 * 1000 });
  } catch (e) {
    if (e && e.code === 'LOCKED') {
      console.log(JSON.stringify({ status: 'ok', message: 'spawn effector locked; noop' }));
      return;
    }
    throw e;
  }

  try {
    const logPath = path.join(root, 'workflow-events.jsonl');
    const { loadCheckpoint, saveCheckpoint, iterateJsonlFromOffset } = require('../lib/effector_checkpoint');

    const dedupe = loadDedupeIndex();

    const spawned = [];
    const { getTasksState } = require('../lib/state');

    const ck = loadCheckpoint('spawn_runner');

    const { newOffset } = iterateJsonlFromOffset(logPath, ck.offset, {
      maxLines: 50000,
      onEvent: ({ event }) => {
        if (spawned.length >= max) return { stop: true };

        if (String(event.type || '').toUpperCase() !== 'AOS_SPAWN_REQUEST') return;

        const p = event.payload || {};
        const taskId = p.taskId;
        const runId = p.runId;
        const role = p.role || 'cto';
        const runnerMessage = p.runnerMessage || '';

        if (!taskId || !runId || !runnerMessage) return;

        const spawnedKey = `AOS_SPAWNED::spawned::${taskId}::${runId}`;
        if (dedupe.entries && dedupe.entries[spawnedKey]) return;

        // Reliability guard: only spawn for the current active run.
        const tasksMap = new Map([...getTasksState().values()].map(t => [t.taskId, t]));
        const t = tasksMap.get(taskId);
        if (!t || t.state !== 'In Progress' || !t.lastDispatch || t.lastDispatch.runId !== runId) {
          appendEvent({
            type: 'AOS_SPAWN_SKIPPED',
            agent: 'god',
            payload: {
              taskId,
              runId,
              role,
              reason: 'stale_request_or_task_not_in_progress',
              taskState: t ? t.state : null,
              lastRunId: t && t.lastDispatch ? t.lastDispatch.runId : null,
              dedupeKey: `spawn_skipped::${taskId}::${runId}::stale`
            }
          });
          return;
        }

        // If result already exists, skip.
        const expectedResult = t.resultPath || (t.artifactsDir ? path.join(t.artifactsDir, runId, 'result.json') : null);
        if (expectedResult && fs.existsSync(expectedResult)) {
          appendEvent({
            type: 'AOS_SPAWN_SKIPPED',
            agent: 'god',
            payload: {
              taskId,
              runId,
              role,
              reason: 'result_already_present',
              resultPath: expectedResult,
              dedupeKey: `spawn_skipped::${taskId}::${runId}::result_present`
            }
          });
          return;
        }

        // Ensure run artifacts directory exists BEFORE spawning.
        // Runners are sandboxed to write only under runArtifactsDir; if the directory doesn't exist,
        // they may fail to produce result.json/summary.md (causing harvest to stall).
        const runArtifactsDir = p.artifactsDir;
        if (runArtifactsDir) {
          try {
            fs.mkdirSync(runArtifactsDir, { recursive: true });
          } catch (e) {
            appendEvent({
              type: 'AOS_SPAWN_SKIPPED',
              agent: 'god',
              payload: {
                taskId,
                runId,
                role,
                reason: 'failed_to_create_artifacts_dir',
                artifactsDir: runArtifactsDir,
                error: String(e && e.message ? e.message : e),
                dedupeKey: `spawn_skipped::${taskId}::${runId}::mkdir_failed`
              }
            });
            return;
          }
        }

        const cmd = [
          'openclaw', 'agent',
          '--agent', role,
          '--thinking', thinking,
          '--timeout', String(timeout),
          '--json',
          '--message', runnerMessage
        ];

        const r = spawnSync(cmd[0], cmd.slice(1), { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });

        if (r.status === 0) {
          appendEvent({
            type: 'AOS_SPAWNED',
            agent: 'god',
            payload: { taskId, runId, role, ok: true, dedupeKey: `spawned::${taskId}::${runId}` }
          });
          spawned.push({ taskId, runId, role, ok: true });
        } else {
          appendEvent({
            type: 'AOS_SPAWNED',
            agent: 'god',
            payload: {
              taskId,
              runId,
              role,
              ok: false,
              exitCode: r.status,
              stderr: (r.stderr || '').slice(0, 2000),
              dedupeKey: `spawned::${taskId}::${runId}`
            }
          });
          spawned.push({ taskId, runId, role, ok: false, exitCode: r.status });
        }

        if (spawned.length >= max) return { stop: true };
      }
    });

    saveCheckpoint('spawn_runner', newOffset);

    console.log(JSON.stringify({ status: 'ok', spawnedCount: spawned.length, spawned, checkpointOffset: newOffset }, null, 2));
  } finally {
    releaseLock(lock);
  }
}

main();
