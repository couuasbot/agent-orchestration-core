#!/usr/bin/env node

// Deterministically execute autopilot actions by writing events (and optional notifications).
// NOTE: This script is an *effector* layer. `dispatch_router.js` remains pure (validate+appendEvent).

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const { getWorkspaceRoot } = require('../lib/workspace');

const WORKSPACE_ROOT = getWorkspaceRoot();

function arg(name, def = '') {
  const pfx = `--${name}=`;
  const hit = process.argv.slice(2).find(a => a.startsWith(pfx));
  if (!hit) return def;
  return hit.slice(pfx.length);
}

function readStdin() {
  return fs.readFileSync(0, 'utf8');
}

function fail(message, extra = {}) {
  console.error(JSON.stringify({ status: 'error', message, ...extra }));
  process.exit(1);
}

function runDispatch({ type, agent = 'god', payload }) {
  const script = path.join(WORKSPACE_ROOT, 'skills', 'aos', 'scripts', 'core', 'dispatch_router.js');
  const p = spawnSync('node', [
    script,
    `--type=${type}`,
    `--agent=${agent}`,
    `--payload=${JSON.stringify(payload || {})}`
  ], { encoding: 'utf8' });

  if (p.status !== 0) {
    fail('dispatch_router failed', { type, payload, stdout: p.stdout, stderr: p.stderr });
  }

  // Best-effort parse
  try { return JSON.parse((p.stdout || '').trim() || '{}'); } catch (_) { return { raw: p.stdout }; }
}

function main() {
  const inputPath = arg('input', '');
  const agent = arg('agent', 'god');

  let txt = '';
  if (inputPath) {
    txt = fs.readFileSync(inputPath, 'utf8');
  } else {
    txt = readStdin();
  }

  let obj = null;
  try {
    obj = JSON.parse(txt);
  } catch (e) {
    fail('input is not valid JSON', { error: e.message });
  }

  const actions = Array.isArray(obj.actions) ? obj.actions : [];
  const executed = [];

  for (const a of actions) {
    const kind = String(a.action || '');

    if (kind === 'noop') {
      executed.push({ action: 'noop', reason: a.reason || null });
      continue;
    }

    if (kind === 'spawn') {
      // 1) mark In Progress
      const dedupeKey = a.dedupeBase || `dispatch::${a.taskId}::${a.runId}`;
      runDispatch({
        type: 'TASK_STATE',
        agent,
        payload: {
          taskId: a.taskId,
          state: 'In Progress',
          lane: a.lane,
          dedupeKey
        }
      });

      // 2) record dispatch
      runDispatch({
        type: 'DISPATCH',
        agent,
        payload: {
          taskId: a.taskId,
          intent: a.title || a.taskId,
          role: a.role || a.roleHint || 'cto',
          runId: a.runId,
          artifactsBaseDir: a.artifactsBaseDir,
          lane: a.lane,
          dedupeKey
        }
      });

      // 3) request a runner spawn (effector layer should fulfill this)
      runDispatch({
        type: 'AOS_SPAWN_REQUEST',
        agent,
        payload: {
          taskId: a.taskId,
          runId: a.runId,
          role: a.role || a.roleHint || 'cto',
          lane: a.lane,
          artifactsDir: a.artifactsDir,
          runnerMessage: a.runnerMessage,
          dedupeKey: `spawn_request::${a.taskId}::${a.runId}`
        }
      });

      // 4) notify spawn
      runDispatch({
        type: 'NOTIFY_REQUEST',
        agent,
        payload: {
          kind: 'spawn',
          taskId: a.taskId,
          runId: a.runId,
          lane: a.lane,
          role: a.role || a.roleHint || 'cto',
          title: a.title || a.taskId,
          dedupeKey: `notify::spawn::${a.runId}`
        }
      });

      executed.push({ action: 'spawn', taskId: a.taskId, runId: a.runId, role: a.role, lane: a.lane });
      continue;
    }

    if (kind === 'review_request') {
      // Ensure AGENT_RESULT exists (so projection captures resultPath)
      runDispatch({
        type: 'AGENT_RESULT',
        agent,
        payload: {
          taskId: a.taskId,
          runId: a.runId,
          resultPath: a.resultPath,
          artifactsBaseDir: a.artifactsBaseDir,
          artifactsDir: a.artifactsDir,
          lane: a.lane,
          dedupeKey: `result::${a.taskId}::${a.runId}`
        }
      });

      const reviewer = a.reviewerHint || 'reviewer';
      runDispatch({
        type: 'TASK_STATE',
        agent,
        payload: {
          taskId: a.taskId,
          state: 'Review',
          lane: a.lane,
          runId: a.runId,
          reviewerHint: reviewer,
          dedupeKey: `review_request::${a.taskId}::${a.runId}::${reviewer}`
        }
      });

      runDispatch({
        type: 'NOTIFY_REQUEST',
        agent,
        payload: {
          kind: 'review_request',
          taskId: a.taskId,
          runId: a.runId,
          lane: a.lane,
          summary: a.summary || '',
          proposedStatus: a.proposedStatus || null,
          reason: a.reason || null,
          dedupeKey: `notify::review_request::${a.runId}`
        }
      });

      executed.push({ action: 'review_request', taskId: a.taskId, runId: a.runId, reviewer });
      continue;
    }

    if (kind === 'complete') {
      runDispatch({
        type: 'AGENT_RESULT',
        agent,
        payload: {
          taskId: a.taskId,
          runId: a.runId,
          resultPath: a.resultPath,
          artifactsBaseDir: a.artifactsBaseDir,
          artifactsDir: a.artifactsDir,
          lane: a.lane,
          dedupeKey: `result::${a.taskId}::${a.runId}`
        }
      });

      runDispatch({
        type: 'TASK_COMPLETE',
        agent,
        payload: {
          taskId: a.taskId,
          runId: a.runId,
          status: a.status,
          resultPath: a.resultPath,
          artifactsBaseDir: a.artifactsBaseDir,
          lane: a.lane,
          reason: a.reason || undefined,
          dedupeKey: `complete::${a.taskId}::${a.runId}::${a.status}`
        }
      });

      runDispatch({
        type: 'NOTIFY_REQUEST',
        agent,
        payload: {
          kind: 'complete',
          taskId: a.taskId,
          runId: a.runId,
          lane: a.lane,
          status: a.status,
          summary: a.summary || '',
          reason: a.reason || null,
          dedupeKey: `notify::complete::${a.runId}::${a.status}`
        }
      });

      executed.push({ action: 'complete', taskId: a.taskId, runId: a.runId, status: a.status });
      continue;
    }

    if (kind === 'stale_fail') {
      runDispatch({
        type: 'TASK_COMPLETE',
        agent,
        payload: {
          taskId: a.taskId,
          runId: a.runId,
          status: 'FAILED',
          lane: a.lane,
          reason: a.reason || 'SLA exceeded',
          artifactsBaseDir: a.artifactsBaseDir,
          dedupeKey: `stale_fail::${a.taskId}::${a.runId}`
        }
      });
      runDispatch({
        type: 'NOTIFY_REQUEST',
        agent,
        payload: {
          kind: 'stale_fail',
          taskId: a.taskId,
          runId: a.runId,
          lane: a.lane,
          reason: a.reason || 'SLA exceeded',
          dedupeKey: `notify::stale_fail::${a.runId}`
        }
      });
      executed.push({ action: 'stale_fail', taskId: a.taskId, runId: a.runId });
      continue;
    }

    if (kind === 'validation_error' || kind === 'mismatch_flag') {
      const dedupeKey = `${kind}::${a.taskId}::${a.runId || ''}::${a.kind || ''}`;
      runDispatch({
        type: 'VALIDATION_ERROR',
        agent,
        payload: {
          kind: kind === 'mismatch_flag' ? 'result_runid_mismatch' : (a.kind || 'result'),
          taskId: a.taskId,
          runId: a.runId || undefined,
          expectedRunId: a.expectedRunId || undefined,
          reportedRunId: a.reportedRunId || undefined,
          resultPath: a.resultPath,
          artifactsBaseDir: a.artifactsBaseDir,
          artifactsDir: a.artifactsDir,
          errors: a.errors || undefined,
          schema: a.schema || undefined,
          reason: a.reason || undefined,
          dedupeKey
        }
      });

      runDispatch({
        type: 'TASK_STATE',
        agent,
        payload: {
          taskId: a.taskId,
          state: 'Review',
          lane: a.lane,
          runId: a.runId || undefined,
          dedupeKey: `validation_to_review::${a.taskId}::${a.runId || 'na'}`
        }
      });

      runDispatch({
        type: 'NOTIFY_REQUEST',
        agent,
        payload: {
          kind,
          taskId: a.taskId,
          runId: a.runId || null,
          lane: a.lane,
          reason: a.reason || 'validation error',
          dedupeKey: `notify::${kind}::${a.taskId}::${a.runId || 'na'}`
        }
      });

      executed.push({ action: kind, taskId: a.taskId, runId: a.runId || null });
      continue;
    }

    executed.push({ action: 'unknown', raw: a });
  }

  console.log(JSON.stringify({ status: 'ok', executedCount: executed.length, executed }, null, 2));
}

main();
