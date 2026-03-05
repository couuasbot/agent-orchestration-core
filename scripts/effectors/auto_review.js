#!/usr/bin/env node

// Auto-review effector: approve "reasonable" Review tasks without human intervention.
//
// Default policy (conservative-but-automatic):
// - Only consider tasks currently in state Review.
// - Only auto-approve when result.json.status indicates success (=> DONE).
// - If result.json.status indicates failure, leave in Review (operator attention).
// - Optional merge manifest constraints:
//   - If merge[] exists, require entries <= maxMergeEntries.
//   - Denylist patterns may be extended later.
//
// Idempotency: skip tasks that already have lastReview recorded.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const { getWorkspaceRoot } = require('../lib/workspace');
const { getTasksState } = require('../lib/state');

function arg(name, def = '') {
  const pfx = `--${name}=`;
  const hit = process.argv.slice(2).find(a => a.startsWith(pfx));
  if (!hit) return def;
  return hit.slice(pfx.length);
}

function safeJsonRead(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return null; }
}


function runDispatch(type, payload) {
  const workspaceRoot = getWorkspaceRoot();
  const script = path.join(workspaceRoot, 'skills', 'aos', 'scripts', 'core', 'dispatch_router.js');
  const p = spawnSync('node', [
    script,
    `--type=${type}`,
    `--agent=god`,
    `--payload=${JSON.stringify(payload || {})}`
  ], { encoding: 'utf8' });

  if (p.status !== 0) {
    return { ok: false, stdout: p.stdout || '', stderr: p.stderr || '' };
  }
  try { return { ok: true, out: JSON.parse((p.stdout || '').trim() || '{}') }; } catch (_) { return { ok: true, out: { raw: p.stdout || '' } }; }
}

function main() {
  const max = Number(arg('max', '3'));
  // Keep a high ceiling; deterministic merge has strong path constraints anyway.
  const maxMergeEntries = Number(arg('maxMergeEntries', '200'));

  const workspaceRoot = getWorkspaceRoot();
  const reviewScript = path.join(workspaceRoot, 'skills', 'aos', 'scripts', 'core', 'task_review.js');

  const tasks = getTasksState();
  const reviewables = [];

  for (const t of tasks.values()) {
    if (t.state !== 'Review') continue;
    if (t.lastReview && t.lastReview.decision) continue; // already reviewed
    if (!t.resultPath || !fs.existsSync(t.resultPath)) continue;
    const runId = (t.lastDispatch && t.lastDispatch.runId) ? t.lastDispatch.runId : '';
    if (!runId) continue;
    reviewables.push({ task: t, runId });
  }

  // Oldest first (so we drain backlog deterministically)
  reviewables.sort((a, b) => String(a.task.updatedAt || '').localeCompare(String(b.task.updatedAt || '')));

  const decided = [];
  const skipped = [];
  const errors = [];

  for (const r of reviewables.slice(0, max)) {
    const obj = safeJsonRead(r.task.resultPath);
    if (!obj) {
      skipped.push({ taskId: r.task.taskId, reason: 'bad_result_json' });
      continue;
    }

    const st = String(obj.status || '').toLowerCase();
    if (st !== 'success' && st !== 'failure') {
      skipped.push({ taskId: r.task.taskId, reason: `unknown_status:${st || 'missing'}` });
      continue;
    }

    // Merge gate: keep only a hard upper bound; path safety is enforced by aos_merge.js.
    const merge = Array.isArray(obj.merge) ? obj.merge : [];
    if (merge.length > maxMergeEntries) {
      skipped.push({ taskId: r.task.taskId, reason: `merge_too_large:${merge.length}` });
      continue;
    }

    const dedupeKey = `auto_review::${r.task.taskId}::${r.runId}::approved`;
    const notes = st === 'success' ? 'auto-approved' : 'auto-approved (failure => FAILED)';

    const p = spawnSync('node', [
      reviewScript,
      `--taskId=${r.task.taskId}`,
      `--runId=${r.runId}`,
      `--reviewer=aos-auto`,
      `--decision=approved`,
      `--notes=${notes}`,
      `--dedupeKey=${dedupeKey}`
    ], { encoding: 'utf8' });

    if (p.status !== 0) {
      errors.push({ taskId: r.task.taskId, runId: r.runId, error: 'task_review_failed', stdout: p.stdout || '', stderr: p.stderr || '' });
      continue;
    }

    // Notify completion (so notifier can send it). Reflect final status from result.json.
    const finalStatus = st === 'success' ? 'DONE' : 'FAILED';
    runDispatch('NOTIFY_REQUEST', {
      kind: 'complete',
      taskId: r.task.taskId,
      runId: r.runId,
      lane: r.task.lane,
      status: finalStatus,
      summary: st === 'success' ? 'Auto-approved and merged' : 'Auto-approved (failure) => FAILED',
      reason: st === 'failure' ? (obj.error && obj.error.message ? String(obj.error.message) : (obj.summary || 'runner reported failure')) : null,
      dedupeKey: `notify::complete::${r.runId}::${finalStatus}`
    });

    decided.push({ taskId: r.task.taskId, runId: r.runId, decision: 'approved', finalStatus });
  }

  console.log(JSON.stringify({ status: 'ok', considered: reviewables.length, decided, skipped, errors }, null, 2));
}

main();
